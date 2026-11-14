import { Injectable } from '@nestjs/common';
import { BillStatus, Prisma } from '@prisma/client';
import { ScopedDataAccess } from '../tenant/scoped-data-access.service';

@Injectable()
export class VendorBalanceService {
  constructor(private readonly scoped: ScopedDataAccess) {}

  async forVendors(vendorIds: string[]): Promise<Map<string, number>> {
    if (vendorIds.length === 0) return new Map();
    const bills = await this.scoped.findMany<{
      vendorId: string;
      total: Prisma.Decimal;
      amountPaid: Prisma.Decimal;
    }>('bill', {
      where: { vendorId: { in: vendorIds }, status: { not: BillStatus.DRAFT } },
      select: { vendorId: true, total: true, amountPaid: true },
    });

    const balances = new Map<string, Prisma.Decimal>();
    for (const bill of bills) {
      const open = bill.total.minus(bill.amountPaid);
      balances.set(
        bill.vendorId,
        (balances.get(bill.vendorId) ?? new Prisma.Decimal(0)).plus(open),
      );
    }

    return new Map(
      vendorIds.map((id) => [
        id,
        Number((balances.get(id) ?? new Prisma.Decimal(0)).toString()),
      ]),
    );
  }

  async forVendor(vendorId: string): Promise<number> {
    return (await this.forVendors([vendorId])).get(vendorId) ?? 0;
  }
}
