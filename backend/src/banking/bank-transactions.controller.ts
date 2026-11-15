import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermission } from '../tenant/require-permission.decorator';
import { ListBankTransactionsDto } from './bank-transaction.dto';
import {
  BankTransactionView,
  BankTransactionsService,
} from './bank-transactions.service';

@Controller('bank-transactions')
export class BankTransactionsController {
  constructor(private readonly transactions: BankTransactionsService) {}

  @Get()
  @RequirePermission('banking:read')
  async list(
    @Query() query: ListBankTransactionsDto,
  ): Promise<{ transactions: BankTransactionView[] }> {
    return { transactions: await this.transactions.list(query) };
  }
}
