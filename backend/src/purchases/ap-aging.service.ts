import { Injectable } from '@nestjs/common';
import { BillStatus, Prisma } from '@prisma/client';
import { toDate } from '../ledger/ledger-engine';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';

export type ApAgingBucketKey = 'current' | '1-30' | '31-60' | '61-90' | '90+';

export interface ApAgingBucket {
  key: ApAgingBucketKey;
  label: string;
  amount: number;
  count: number;
}

export interface ApAgingVendor {
  vendorId: string;
  vendorCode: string;
  vendorName: string;
  current: number;
  days1To30: number;
  days31To60: number;
  days61To90: number;
  days90Plus: number;
  total: number;
}

export interface ApAgingBill {
  id: string;
  number: string;
  vendorId: string;
  vendorCode: string;
  vendorName: string;
  issueDate: string;
  dueDate: string;
  daysOverdue: number;
  bucket: ApAgingBucketKey;
  balanceDue: number;
}

export interface ApAgingView {
  asOf: string;
  buckets: ApAgingBucket[];
  vendors: ApAgingVendor[];
  bills: ApAgingBill[];
  overdue: ApAgingBill[];
  total: number;
}

const BUCKETS: Array<{ key: ApAgingBucketKey; label: string }> = [
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

function bucketFor(daysOverdue: number): ApAgingBucketKey {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return '1-30';
  if (daysOverdue <= 60) return '31-60';
  if (daysOverdue <= 90) return '61-90';
  return '90+';
}

@Injectable()
export class ApAgingService {
  constructor(
    private readonly tenant: TenantContextService,
    private readonly prisma: PrismaService,
  ) {}

  async report(asOfInput?: string): Promise<ApAgingView> {
    const { organizationId } = await this.tenant.get();
    const asOfValue = asOfInput ?? todayIso();
    const asOf = toDate(asOfValue, 'asOf');

    const rows = await this.prisma.bill.findMany({
      where: {
        organizationId,
        status: { not: BillStatus.DRAFT },
        issueDate: { lte: asOf },
      },
      orderBy: [{ dueDate: 'asc' }, { number: 'asc' }],
      select: {
        id: true,
        number: true,
        issueDate: true,
        dueDate: true,
        total: true,
        vendorId: true,
        vendor: { select: { code: true, name: true } },
        paymentApplications: {
          where: {
            organizationId,
            billPayment: { date: { lte: asOf } },
          },
          select: { amount: true },
        },
      },
    });

    const bucketTotals = new Map<ApAgingBucketKey, { amount: Prisma.Decimal; count: number }>(
      BUCKETS.map((bucket) => [bucket.key, { amount: new Prisma.Decimal(0), count: 0 }]),
    );
    const vendors = new Map<string, ApAgingVendor>();
    const bills: ApAgingBill[] = [];

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

      const vendor =
        vendors.get(row.vendorId) ??
        ({
          vendorId: row.vendorId,
          vendorCode: row.vendor.code,
          vendorName: row.vendor.name,
          current: 0,
          days1To30: 0,
          days31To60: 0,
          days61To90: 0,
          days90Plus: 0,
          total: 0,
        } satisfies ApAgingVendor);
      vendor.total = roundMoney(vendor.total + balanceDue);
      if (bucket === 'current') vendor.current = roundMoney(vendor.current + balanceDue);
      if (bucket === '1-30') vendor.days1To30 = roundMoney(vendor.days1To30 + balanceDue);
      if (bucket === '31-60') vendor.days31To60 = roundMoney(vendor.days31To60 + balanceDue);
      if (bucket === '61-90') vendor.days61To90 = roundMoney(vendor.days61To90 + balanceDue);
      if (bucket === '90+') vendor.days90Plus = roundMoney(vendor.days90Plus + balanceDue);
      vendors.set(vendor.vendorId, vendor);

      bills.push({
        id: row.id,
        number: row.number,
        vendorId: row.vendorId,
        vendorCode: row.vendor.code,
        vendorName: row.vendor.name,
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
      vendors: [...vendors.values()].sort(
        (left, right) =>
          right.total - left.total || left.vendorName.localeCompare(right.vendorName),
      ),
      bills,
      overdue: bills
        .filter((bill) => bill.daysOverdue > 0)
        .sort(
          (left, right) =>
            right.daysOverdue - left.daysOverdue || right.balanceDue - left.balanceDue,
        ),
      total: roundMoney(bucketViews.reduce((sum, bucket) => sum + bucket.amount, 0)),
    };
  }
}
