import { BadRequestException, Injectable } from '@nestjs/common';
import { AccountType, Prisma } from '@prisma/client';
import { toDate } from '../ledger/ledger-engine';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { PeriodQueryDto, AsOfQueryDto } from './reports.dto';
import {
  BalanceSheetReport,
  CashFlowReport,
  ProfitLossReport,
  ReportAccountBalances,
  ReportingEngine,
  TrialBalanceReport,
} from './reporting-engine';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function zero(): Prisma.Decimal {
  return new Prisma.Decimal(0);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function fiscalStartOnOrBefore(to: Date, month: number, day: number): Date {
  const build = (year: number) =>
    new Date(Date.UTC(year, month - 1, Math.min(day, daysInMonth(year, month))));
  let candidate = build(to.getUTCFullYear());
  if (candidate > to) {
    candidate = build(to.getUTCFullYear() - 1);
  }
  return candidate;
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly tenant: TenantContextService,
    private readonly prisma: PrismaService,
    private readonly engine: ReportingEngine,
  ) {}

  async profitLoss(query: PeriodQueryDto): Promise<ProfitLossReport> {
    const { organizationId } = await this.tenant.get();
    const period = await this.resolvePeriod(organizationId, query);
    const accounts = await this.accountBalances(organizationId, {
      gte: new Date(`${period.from}T00:00:00.000Z`),
      lte: new Date(`${period.to}T00:00:00.000Z`),
    });
    return this.engine.profitAndLoss(period, accounts);
  }

  async balanceSheet(query: AsOfQueryDto): Promise<BalanceSheetReport> {
    const { organizationId } = await this.tenant.get();
    const asOf = this.resolveAsOf(query);
    const accounts = await this.accountBalances(organizationId, {
      lte: new Date(`${asOf}T00:00:00.000Z`),
    });
    return this.engine.balanceSheet(asOf, accounts);
  }

  async trialBalance(query: AsOfQueryDto): Promise<TrialBalanceReport> {
    const { organizationId } = await this.tenant.get();
    const asOf = this.resolveAsOf(query);
    const accounts = await this.accountBalances(organizationId, {
      lte: new Date(`${asOf}T00:00:00.000Z`),
    });
    return this.engine.trialBalance(asOf, accounts);
  }

  async cashFlow(query: PeriodQueryDto): Promise<CashFlowReport> {
    const { organizationId } = await this.tenant.get();
    const period = await this.resolvePeriod(organizationId, query);
    const from = new Date(`${period.from}T00:00:00.000Z`);
    const to = new Date(`${period.to}T00:00:00.000Z`);

    const [accounts, bankAccounts, cashLedgerAccounts] = await Promise.all([
      this.prisma.account.findMany({
        where: { organizationId },
        select: { id: true, code: true, name: true, type: true, subtype: true },
        orderBy: { code: 'asc' },
      }),
      this.prisma.bankAccount.findMany({
        where: { organizationId, active: true },
        select: { ledgerAccountId: true },
      }),
      this.prisma.account.findMany({
        where: { organizationId, code: '1000', active: true },
        select: { id: true, code: true, name: true, type: true, subtype: true },
      }),
    ]);

    const cashIds = [
      ...new Set([
        ...bankAccounts.map((account) => account.ledgerAccountId),
        ...cashLedgerAccounts.map((account) => account.id),
      ]),
    ];
    const cashAccounts = accounts.filter((account) => cashIds.includes(account.id));

    const [before, through, entries] = await Promise.all([
      this.prisma.journalLine.aggregate({
        where: {
          organizationId,
          accountId: { in: cashIds },
          entry: { date: { lt: from } },
        },
        _sum: { debit: true, credit: true },
      }),
      this.prisma.journalLine.aggregate({
        where: {
          organizationId,
          accountId: { in: cashIds },
          entry: { date: { lte: to } },
        },
        _sum: { debit: true, credit: true },
      }),
      this.prisma.journalEntry.findMany({
        where: {
          organizationId,
          date: { gte: from, lte: to },
          lines: { some: { accountId: { in: cashIds } } },
        },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
        include: {
          lines: {
            include: {
              account: { select: { id: true, code: true, name: true, type: true, subtype: true } },
            },
          },
        },
      }),
    ]);

    const net = (sum: { debit: Prisma.Decimal | null; credit: Prisma.Decimal | null }) =>
      (sum.debit ?? zero()).minus(sum.credit ?? zero());

    return this.engine.cashFlow({
      from: period.from,
      to: period.to,
      cashAccounts,
      beginningCash: net(before._sum),
      endingCash: net(through._sum),
      entries: entries.map((entry) => ({
        id: entry.id,
        date: isoDate(entry.date),
        lines: entry.lines.map((line) => ({
          accountId: line.accountId,
          debit: line.debit,
          credit: line.credit,
          account: line.account,
        })),
      })),
    });
  }

  private resolveAsOf(query: AsOfQueryDto): string {
    return isoDate(toDate(query.asOf ?? todayIso(), 'asOf'));
  }

  private async resolvePeriod(
    organizationId: string,
    query: PeriodQueryDto,
  ): Promise<{ from: string; to: string }> {
    const to = toDate(query.to ?? todayIso(), 'to');
    let from: Date;
    if (query.from) {
      from = toDate(query.from, 'from');
    } else {
      const organization = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { fiscalYearStartMonth: true, fiscalYearStartDay: true },
      });
      if (!organization) {
        throw new BadRequestException('Organization is not available');
      }
      from = fiscalStartOnOrBefore(
        to,
        organization.fiscalYearStartMonth,
        organization.fiscalYearStartDay,
      );
    }
    if (from > to) {
      throw new BadRequestException('from must be on or before to');
    }
    return { from: isoDate(from), to: isoDate(to) };
  }

  private async accountBalances(
    organizationId: string,
    date: Prisma.DateTimeFilter,
  ): Promise<ReportAccountBalances[]> {
    const [accounts, sums] = await Promise.all([
      this.prisma.account.findMany({
        where: { organizationId },
        select: {
          id: true,
          code: true,
          name: true,
          type: true,
          subtype: true,
        },
        orderBy: { code: 'asc' },
      }),
      this.prisma.journalLine.groupBy({
        by: ['accountId'],
        where: { organizationId, entry: { date } },
        _sum: { debit: true, credit: true },
      }),
    ]);

    const byAccount = new Map(sums.map((row) => [row.accountId, row._sum]));
    return accounts.map((account) => ({
      ...account,
      type: account.type as AccountType,
      debit: byAccount.get(account.id)?.debit ?? zero(),
      credit: byAccount.get(account.id)?.credit ?? zero(),
    }));
  }
}
