import { Injectable } from '@nestjs/common';
import { InvoiceStatus, Prisma } from '@prisma/client';
import { toDate } from '../ledger/ledger-engine';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';

export type AgingBucketKey = 'current' | '1-30' | '31-60' | '61-90' | '90+';

export interface AgingBucket {
  key: AgingBucketKey;
  label: string;
  amount: number;
  count: number;
}

export interface AgingCustomer {
  customerId: string;
  customerCode: string;
  customerName: string;
  current: number;
  days1To30: number;
  days31To60: number;
  days61To90: number;
  days90Plus: number;
  total: number;
}

export interface AgingInvoice {
  id: string;
  number: string;
  customerId: string;
  customerCode: string;
  customerName: string;
  issueDate: string;
  dueDate: string;
  daysOverdue: number;
  bucket: AgingBucketKey;
  balanceDue: number;
}

export interface ArAgingView {
  asOf: string;
  buckets: AgingBucket[];
  customers: AgingCustomer[];
  invoices: AgingInvoice[];
  overdue: AgingInvoice[];
  total: number;
}

const BUCKETS: Array<{ key: AgingBucketKey; label: string }> = [
  { key: 'current', label: 'Current' },
  { key: '1-30', label: '1–30' },
  { key: '31-60', label: '31–60' },
  { key: '61-90', label: '61–90' },
  { key: '90+', label: '90+' },
];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function dayNumber(value: string): number {
  return Math.floor(Date.parse(`${value}T00:00:00.000Z`) / 86_400_000);
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function bucketFor(daysOverdue: number): AgingBucketKey {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return '1-30';
  if (daysOverdue <= 60) return '31-60';
  if (daysOverdue <= 90) return '61-90';
  return '90+';
}

@Injectable()
export class ArAgingService {
  constructor(
    private readonly tenant: TenantContextService,
    private readonly prisma: PrismaService,
  ) {}

  async report(asOfInput?: string): Promise<ArAgingView> {
    const { organizationId } = await this.tenant.get();
    const asOfValue = asOfInput ?? todayIso();
    const asOf = toDate(asOfValue, 'asOf');

    const rows = await this.prisma.invoice.findMany({
      where: {
        organizationId,
        status: { not: InvoiceStatus.DRAFT },
        issueDate: { lte: asOf },
      },
      orderBy: [{ dueDate: 'asc' }, { number: 'asc' }],
      select: {
        id: true,
        number: true,
        issueDate: true,
        dueDate: true,
        total: true,
        customerId: true,
        customer: { select: { code: true, name: true } },
        paymentApplications: {
          where: {
            organizationId,
            payment: { date: { lte: asOf } },
          },
          select: { amount: true },
        },
      },
    });

    const bucketTotals = new Map<AgingBucketKey, { amount: Prisma.Decimal; count: number }>(
      BUCKETS.map((bucket) => [bucket.key, { amount: new Prisma.Decimal(0), count: 0 }]),
    );
    const customers = new Map<string, AgingCustomer>();
    const invoices: AgingInvoice[] = [];

    for (const row of rows) {
      const paidToDate = row.paymentApplications.reduce(
        (sum, application) => sum.plus(application.amount),
        new Prisma.Decimal(0),
      );
      const balance = row.total.minus(paidToDate);
      if (!balance.gt(0)) continue;

      const dueDate = isoDate(row.dueDate);
      const daysOverdue = Math.max(0, dayNumber(asOfValue) - dayNumber(dueDate));
      const bucket = bucketFor(daysOverdue);
      const balanceDue = roundMoney(Number(balance.toString()));

      const bucketTotal = bucketTotals.get(bucket)!;
      bucketTotal.amount = bucketTotal.amount.plus(balance);
      bucketTotal.count += 1;

      const customer =
        customers.get(row.customerId) ??
        ({
          customerId: row.customerId,
          customerCode: row.customer.code,
          customerName: row.customer.name,
          current: 0,
          days1To30: 0,
          days31To60: 0,
          days61To90: 0,
          days90Plus: 0,
          total: 0,
        } satisfies AgingCustomer);
      customer.total = roundMoney(customer.total + balanceDue);
      if (bucket === 'current') customer.current = roundMoney(customer.current + balanceDue);
      if (bucket === '1-30') customer.days1To30 = roundMoney(customer.days1To30 + balanceDue);
      if (bucket === '31-60') customer.days31To60 = roundMoney(customer.days31To60 + balanceDue);
      if (bucket === '61-90') customer.days61To90 = roundMoney(customer.days61To90 + balanceDue);
      if (bucket === '90+') customer.days90Plus = roundMoney(customer.days90Plus + balanceDue);
      customers.set(customer.customerId, customer);

      invoices.push({
        id: row.id,
        number: row.number,
        customerId: row.customerId,
        customerCode: row.customer.code,
        customerName: row.customer.name,
        issueDate: isoDate(row.issueDate),
        dueDate,
        daysOverdue,
        bucket,
        balanceDue,
      });
    }

    const bucketViews = BUCKETS.map((bucket) => {
      const total = bucketTotals.get(bucket.key)!;
      return {
        ...bucket,
        amount: roundMoney(Number(total.amount.toString())),
        count: total.count,
      };
    });

    return {
      asOf: asOfValue,
      buckets: bucketViews,
      customers: [...customers.values()].sort(
        (left, right) =>
          right.total - left.total || left.customerName.localeCompare(right.customerName),
      ),
      invoices,
      overdue: invoices
        .filter((invoice) => invoice.daysOverdue > 0)
        .sort(
          (left, right) =>
            right.daysOverdue - left.daysOverdue || right.balanceDue - left.balanceDue,
        ),
      total: roundMoney(bucketViews.reduce((sum, bucket) => sum + bucket.amount, 0)),
    };
  }
}
