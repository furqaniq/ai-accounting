import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ScopedDataAccess } from '../tenant/scoped-data-access.service';

/**
 * Customer balances are derived at read time; there is no stored balance column
 * and no endpoint accepts one. Open, non-draft invoices contribute their unpaid
 * total. Payments in 011 will reduce the same derivation through amountPaid.
 */
@Injectable()
export class CustomerBalanceService {
  constructor(private readonly scoped: ScopedDataAccess) {}

  async forCustomers(customerIds: string[]): Promise<Map<string, number>> {
    if (customerIds.length === 0) return new Map();
    const invoices = await this.scoped.findMany<{
      customerId: string;
      total: Prisma.Decimal;
      amountPaid: Prisma.Decimal;
    }>('invoice', {
      where: { customerId: { in: customerIds }, status: { not: 'DRAFT' } },
      select: { customerId: true, total: true, amountPaid: true },
    });

    const balances = new Map<string, Prisma.Decimal>();
    for (const invoice of invoices) {
      const open = invoice.total.minus(invoice.amountPaid);
      balances.set(invoice.customerId, (balances.get(invoice.customerId) ?? new Prisma.Decimal(0)).plus(open));
    }

    return new Map(
      customerIds.map((id) => [id, Number((balances.get(id) ?? new Prisma.Decimal(0)).toString())]),
    );
  }

  async forCustomer(customerId: string): Promise<number> {
    return (await this.forCustomers([customerId])).get(customerId) ?? 0;
  }
}
