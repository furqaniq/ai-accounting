import { BadRequestException, Injectable } from '@nestjs/common';
import { AccountType, BillStatus, InvoiceStatus, Prisma } from '@prisma/client';
import { toDate } from '../ledger/ledger-engine';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { PeriodQueryDto, AsOfQueryDto } from './reports.dto';
import {
  BalanceSheetReport,
  CashFlowReport,
  ExpensesByCategoryReport,
  ProfitLossReport,
  ReportAccountBalances,
  ReportingEngine,
  SalesByCustomerReport,
  SalesByItemReport,
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

  async salesByCustomer(query: PeriodQueryDto): Promise<SalesByCustomerReport> {
    const { organizationId } = await this.tenant.get();
    const period = await this.resolvePeriod(organizationId, query);
    const from = new Date(`${period.from}T00:00:00.000Z`);
    const to = new Date(`${period.to}T00:00:00.000Z`);

    const [invoices, ledgerIncome] = await Promise.all([
      this.prisma.invoice.findMany({
        where: {
          organizationId,
          status: { not: InvoiceStatus.DRAFT },
          issueDate: { gte: from, lte: to },
        },
        orderBy: [{ issueDate: 'asc' }, { number: 'asc' }],
        select: {
          id: true,
          number: true,
          issueDate: true,
          subtotal: true,
          taxTotal: true,
          total: true,
          customerId: true,
          customer: { select: { code: true, name: true } },
          lines: { select: { quantity: true } },
        },
      }),
      this.ledgerTotal(organizationId, AccountType.INCOME, from, to, 'credit'),
    ]);

    return this.engine.salesByCustomer(
      period,
      invoices.map((invoice) => ({
        id: invoice.id,
        number: invoice.number,
        issueDate: isoDate(invoice.issueDate),
        customerId: invoice.customerId,
        customerCode: invoice.customer.code,
        customerName: invoice.customer.name,
        subtotal: invoice.subtotal,
        taxTotal: invoice.taxTotal,
        total: invoice.total,
        quantity: invoice.lines.reduce(
          (sum, line) => sum.plus(line.quantity),
          new Prisma.Decimal(0),
        ),
      })),
      ledgerIncome,
    );
  }

  async salesByItem(query: PeriodQueryDto): Promise<SalesByItemReport> {
    const { organizationId } = await this.tenant.get();
    const period = await this.resolvePeriod(organizationId, query);
    const from = new Date(`${period.from}T00:00:00.000Z`);
    const to = new Date(`${period.to}T00:00:00.000Z`);

    const [lines, ledgerIncome] = await Promise.all([
      this.prisma.invoiceLine.findMany({
        where: {
          organizationId,
          invoice: {
            status: { not: InvoiceStatus.DRAFT },
            issueDate: { gte: from, lte: to },
          },
        },
        orderBy: [{ invoiceId: 'asc' }, { position: 'asc' }],
        select: {
          id: true,
          invoiceId: true,
          quantity: true,
          amount: true,
          itemId: true,
          item: { select: { code: true, name: true } },
          invoice: { select: { number: true, issueDate: true } },
        },
      }),
      this.ledgerTotal(organizationId, AccountType.INCOME, from, to, 'credit'),
    ]);

    return this.engine.salesByItem(
      period,
      lines.map((line) => ({
        lineId: line.id,
        invoiceId: line.invoiceId,
        number: line.invoice.number,
        issueDate: isoDate(line.invoice.issueDate),
        itemId: line.itemId,
        itemCode: line.item.code,
        itemName: line.item.name,
        quantity: line.quantity,
        amount: line.amount,
      })),
      ledgerIncome,
    );
  }

  async expensesByCategory(query: PeriodQueryDto): Promise<ExpensesByCategoryReport> {
    const { organizationId } = await this.tenant.get();
    const period = await this.resolvePeriod(organizationId, query);
    const from = new Date(`${period.from}T00:00:00.000Z`);
    const to = new Date(`${period.to}T00:00:00.000Z`);

    const [expenses, billLines, ledgerExpenses] = await Promise.all([
      this.prisma.expense.findMany({
        where: { organizationId, date: { gte: from, lte: to } },
        orderBy: [{ date: 'asc' }, { number: 'asc' }],
        select: {
          id: true,
          number: true,
          date: true,
          amount: true,
          memo: true,
          categoryAccountId: true,
          categoryAccount: { select: { code: true, name: true } },
          vendor: { select: { name: true } },
        },
      }),
      this.prisma.billLine.findMany({
        where: {
          organizationId,
          bill: {
            status: { not: BillStatus.DRAFT },
            issueDate: { gte: from, lte: to },
          },
        },
        orderBy: [{ billId: 'asc' }, { position: 'asc' }],
        select: {
          id: true,
          amount: true,
          description: true,
          expenseAccountId: true,
          expenseAccount: { select: { code: true, name: true } },
          bill: {
            select: {
              id: true,
              number: true,
              issueDate: true,
              vendor: { select: { name: true } },
            },
          },
        },
      }),
      this.ledgerTotal(organizationId, AccountType.EXPENSE, from, to, 'debit'),
    ]);

    return this.engine.expensesByCategory(
      period,
      [
        ...expenses.map((expense) => ({
          categoryAccountId: expense.categoryAccountId,
          categoryCode: expense.categoryAccount.code,
          categoryName: expense.categoryAccount.name,
          sourceType: 'expense' as const,
          sourceId: expense.id,
          sourceNumber: expense.number,
          date: isoDate(expense.date),
          amount: expense.amount,
          party: expense.vendor?.name ?? null,
          memo: expense.memo,
        })),
        ...billLines.map((line) => ({
          categoryAccountId: line.expenseAccountId,
          categoryCode: line.expenseAccount.code,
          categoryName: line.expenseAccount.name,
          sourceType: 'bill' as const,
          sourceId: line.bill.id,
          sourceNumber: line.bill.number,
          date: isoDate(line.bill.issueDate),
          amount: line.amount,
          party: line.bill.vendor.name,
          memo: line.description,
        })),
      ],
      ledgerExpenses,
    );
  }

  private async ledgerTotal(
    organizationId: string,
    type: AccountType,
    from: Date,
    to: Date,
    normal: 'debit' | 'credit',
  ): Promise<Prisma.Decimal> {
    const sums = await this.prisma.journalLine.aggregate({
      where: {
        organizationId,
        account: { type },
        entry: { date: { gte: from, lte: to } },
      },
      _sum: { debit: true, credit: true },
    });
    const debit = sums._sum.debit ?? zero();
    const credit = sums._sum.credit ?? zero();
    return normal === 'debit' ? debit.minus(credit) : credit.minus(debit);
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
