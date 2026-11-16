import { Injectable } from '@nestjs/common';
import { AccountType, BillStatus, InvoiceStatus, Prisma } from '@prisma/client';
import { ApAgingService } from '../purchases/ap-aging.service';
import { ArAgingService } from '../sales/ar-aging.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { PeriodQueryDto } from './reports.dto';
import { ReportsService } from './reports.service';

export interface DashboardCashAccount {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  balance: number;
  netChange: number;
}

export interface DashboardTrendBucket {
  month: string;
  label: string;
  income: number;
  expenses: number;
  net: number;
}

export interface DashboardActivity {
  type: 'invoice' | 'bill' | 'expense' | 'payment' | 'bill-payment';
  id: string;
  number: string;
  party: string | null;
  date: string;
  amount: number;
  status: string;
  href: string;
}

export interface DashboardReport {
  from: string;
  to: string;
  cash: {
    total: number;
    accounts: DashboardCashAccount[];
  };
  receivables: {
    total: number;
    overdue: number;
    openCount: number;
  };
  payables: {
    total: number;
    overdue: number;
    openCount: number;
  };
  trend: {
    buckets: DashboardTrendBucket[];
    totalIncome: number;
    totalExpenses: number;
    netIncome: number;
  };
  recentActivity: DashboardActivity[];
  attention: {
    overdueInvoices: number;
    overdueBills: number;
    unmatchedBankTransactions: number;
  };
}

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function money(value: Prisma.Decimal): number {
  return Number(value.toDecimalPlaces(2).toString());
}

function sumMoney(values: number[]): number {
  return Math.round(values.reduce((sum, value) => sum + value, 0) * 100) / 100;
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly tenant: TenantContextService,
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
    private readonly arAging: ArAgingService,
    private readonly apAging: ApAgingService,
  ) {}

  async report(query: PeriodQueryDto): Promise<DashboardReport> {
    const { organizationId } = await this.tenant.get();
    const period = await this.reports.resolvePeriod(organizationId, query);
    const from = new Date(`${period.from}T00:00:00.000Z`);
    const to = new Date(`${period.to}T00:00:00.000Z`);

    const [ar, ap, cash, trend, recentActivity, unmatchedBankTransactions] = await Promise.all([
      this.arAging.report(period.to),
      this.apAging.report(period.to),
      this.cashPosition(organizationId, from, to),
      this.incomeExpenseTrend(organizationId, from, to),
      this.recentActivity(organizationId, from, to),
      this.prisma.bankTransaction.count({
        where: { organizationId, matchState: 'UNMATCHED' },
      }),
    ]);

    return {
      from: period.from,
      to: period.to,
      cash,
      receivables: {
        total: ar.total,
        overdue: sumMoney(ar.overdue.map((invoice) => invoice.balanceDue)),
        openCount: ar.invoices.length,
      },
      payables: {
        total: ap.total,
        overdue: sumMoney(ap.overdue.map((bill) => bill.balanceDue)),
        openCount: ap.bills.length,
      },
      trend,
      recentActivity,
      attention: {
        overdueInvoices: ar.overdue.length,
        overdueBills: ap.overdue.length,
        unmatchedBankTransactions,
      },
    };
  }

  private async cashPosition(
    organizationId: string,
    from: Date,
    to: Date,
  ): Promise<DashboardReport['cash']> {
    const [accounts, bankAccounts, cashLedgerAccounts] = await Promise.all([
      this.prisma.account.findMany({
        where: { organizationId },
        select: { id: true, code: true, name: true, type: true },
        orderBy: { code: 'asc' },
      }),
      this.prisma.bankAccount.findMany({
        where: { organizationId, active: true },
        select: { ledgerAccountId: true },
      }),
      this.prisma.account.findMany({
        where: { organizationId, code: '1000', active: true },
        select: { id: true },
      }),
    ]);

    const cashIds = [
      ...new Set([
        ...bankAccounts.map((account) => account.ledgerAccountId),
        ...cashLedgerAccounts.map((account) => account.id),
      ]),
    ];
    if (cashIds.length === 0) return { total: 0, accounts: [] };

    const [through, inPeriod] = await Promise.all([
      this.prisma.journalLine.groupBy({
        by: ['accountId'],
        where: {
          organizationId,
          accountId: { in: cashIds },
          entry: { date: { lte: to } },
        },
        _sum: { debit: true, credit: true },
      }),
      this.prisma.journalLine.groupBy({
        by: ['accountId'],
        where: {
          organizationId,
          accountId: { in: cashIds },
          entry: { date: { gte: from, lte: to } },
        },
        _sum: { debit: true, credit: true },
      }),
    ]);

    const balanceByAccount = new Map(through.map((row) => [row.accountId, row._sum]));
    const changeByAccount = new Map(inPeriod.map((row) => [row.accountId, row._sum]));
    const net = (sum: { debit: Prisma.Decimal | null; credit: Prisma.Decimal | null } | undefined) =>
      (sum?.debit ?? new Prisma.Decimal(0)).minus(sum?.credit ?? new Prisma.Decimal(0));

    const rows = accounts
      .filter((account) => cashIds.includes(account.id))
      .map((account) => ({
        id: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
        balance: money(net(balanceByAccount.get(account.id))),
        netChange: money(net(changeByAccount.get(account.id))),
      }));

    return {
      total: sumMoney(rows.map((row) => row.balance)),
      accounts: rows,
    };
  }

  private async incomeExpenseTrend(
    organizationId: string,
    from: Date,
    to: Date,
  ): Promise<DashboardReport['trend']> {
    const lines = await this.prisma.journalLine.findMany({
      where: {
        organizationId,
        account: { type: { in: [AccountType.INCOME, AccountType.EXPENSE] } },
        entry: { date: { gte: from, lte: to } },
      },
      select: {
        debit: true,
        credit: true,
        account: { select: { type: true } },
        entry: { select: { date: true } },
      },
    });

    const months: Array<{ month: string; label: string }> = [];
    const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
    const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
    while (cursor <= end) {
      const month = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`;
      months.push({
        month,
        label: `${MONTH_LABELS[cursor.getUTCMonth()]} ${cursor.getUTCFullYear()}`,
      });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }

    const buckets = new Map(
      months.map((bucket) => [
        bucket.month,
        {
          income: new Prisma.Decimal(0),
          expenses: new Prisma.Decimal(0),
        },
      ]),
    );

    for (const line of lines) {
      const bucket = buckets.get(line.entry.date.toISOString().slice(0, 7));
      if (!bucket) continue;
      if (line.account.type === AccountType.INCOME) {
        bucket.income = bucket.income.plus(line.credit.minus(line.debit));
      } else {
        bucket.expenses = bucket.expenses.plus(line.debit.minus(line.credit));
      }
    }

    let totalIncome = new Prisma.Decimal(0);
    let totalExpenses = new Prisma.Decimal(0);
    const bucketsView = months.map((month) => {
      const bucket = buckets.get(month.month)!;
      const income = money(bucket.income);
      const expenses = money(bucket.expenses);
      totalIncome = totalIncome.plus(bucket.income);
      totalExpenses = totalExpenses.plus(bucket.expenses);
      return {
        month: month.month,
        label: month.label,
        income,
        expenses,
        net: Math.round((income - expenses) * 100) / 100,
      };
    });

    return {
      buckets: bucketsView,
      totalIncome: money(totalIncome),
      totalExpenses: money(totalExpenses),
      netIncome: money(totalIncome.minus(totalExpenses)),
    };
  }

  private async recentActivity(
    organizationId: string,
    from: Date,
    to: Date,
  ): Promise<DashboardActivity[]> {
    const date = { gte: from, lte: to };
    const [invoices, bills, expenses, payments, billPayments] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { organizationId, status: { not: InvoiceStatus.DRAFT }, issueDate: date },
        orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
        take: 8,
        select: {
          id: true,
          number: true,
          issueDate: true,
          total: true,
          status: true,
          customer: { select: { name: true } },
        },
      }),
      this.prisma.bill.findMany({
        where: { organizationId, status: { not: BillStatus.DRAFT }, issueDate: date },
        orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
        take: 8,
        select: {
          id: true,
          number: true,
          issueDate: true,
          total: true,
          status: true,
          vendor: { select: { name: true } },
        },
      }),
      this.prisma.expense.findMany({
        where: { organizationId, date },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: 8,
        select: {
          id: true,
          number: true,
          date: true,
          amount: true,
          memo: true,
          vendor: { select: { name: true } },
          categoryAccount: { select: { name: true } },
        },
      }),
      this.prisma.payment.findMany({
        where: { organizationId, date },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: 8,
        select: {
          id: true,
          number: true,
          date: true,
          amount: true,
          direction: true,
          customer: { select: { name: true } },
        },
      }),
      this.prisma.billPayment.findMany({
        where: { organizationId, date },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: 8,
        select: {
          id: true,
          number: true,
          date: true,
          amount: true,
          vendor: { select: { name: true } },
        },
      }),
    ]);

    const rows: DashboardActivity[] = [
      ...invoices.map((row) => ({
        type: 'invoice' as const,
        id: row.id,
        number: row.number,
        party: row.customer.name,
        date: isoDate(row.issueDate),
        amount: money(row.total),
        status: row.status,
        href: `/invoices?invoice=${row.id}`,
      })),
      ...bills.map((row) => ({
        type: 'bill' as const,
        id: row.id,
        number: row.number,
        party: row.vendor.name,
        date: isoDate(row.issueDate),
        amount: money(row.total),
        status: row.status,
        href: `/bills?bill=${row.id}`,
      })),
      ...expenses.map((row) => ({
        type: 'expense' as const,
        id: row.id,
        number: row.number,
        party: row.vendor?.name ?? row.memo ?? row.categoryAccount.name,
        date: isoDate(row.date),
        amount: money(row.amount),
        status: 'POSTED',
        href: `/expenses?expense=${row.id}`,
      })),
      ...payments.map((row) => ({
        type: 'payment' as const,
        id: row.id,
        number: row.number,
        party: row.customer.name,
        date: isoDate(row.date),
        amount: money(row.amount),
        status: row.direction,
        href: '/payments',
      })),
      ...billPayments.map((row) => ({
        type: 'bill-payment' as const,
        id: row.id,
        number: row.number,
        party: row.vendor.name,
        date: isoDate(row.date),
        amount: money(row.amount),
        status: 'SENT',
        href: '/bill-payments',
      })),
    ];

    return rows
      .sort((left, right) => right.date.localeCompare(left.date) || left.number.localeCompare(right.number))
      .slice(0, 8);
  }
}
