import { Injectable } from '@nestjs/common';

/**
 * Customer balances are derived at read time; there is no stored balance column
 * and no endpoint accepts one. Sales invoices and payments arrive in later
 * slices (008/011); their open balances will be summed here. Until then the
 * sales subledger has no activity, so every derived balance is zero.
 */
@Injectable()
export class CustomerBalanceService {
  async forCustomers(customerIds: string[]): Promise<Map<string, number>> {
    return new Map(customerIds.map((id) => [id, 0]));
  }

  async forCustomer(customerId: string): Promise<number> {
    return (await this.forCustomers([customerId])).get(customerId) ?? 0;
  }
}
