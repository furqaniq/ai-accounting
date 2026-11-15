import { Body, Controller, Param, Post } from '@nestjs/common';
import { RequirePermission } from '../tenant/require-permission.decorator';
import { BankTransactionView } from './bank-transactions.service';
import { BankTransactionResolutionService } from './bank-transaction-resolution.service';
import {
  ResolveCategorizationDto,
  ResolveExpenseDto,
  ResolvePaymentDto,
  ResolveTransferDto,
} from './resolve-transaction.dto';

@Controller('bank-transactions')
export class BankTransactionResolutionController {
  constructor(private readonly resolutions: BankTransactionResolutionService) {}

  @Post(':id/categorize')
  @RequirePermission('banking:manage')
  categorize(
    @Param('id') id: string,
    @Body() input: ResolveCategorizationDto,
  ): Promise<BankTransactionView> {
    return this.resolutions.categorize(id, input);
  }

  @Post(':id/transfer')
  @RequirePermission('banking:manage')
  transfer(
    @Param('id') id: string,
    @Body() input: ResolveTransferDto,
  ): Promise<BankTransactionView> {
    return this.resolutions.transfer(id, input);
  }

  @Post(':id/expense')
  @RequirePermission('banking:manage')
  expense(
    @Param('id') id: string,
    @Body() input: ResolveExpenseDto,
  ): Promise<BankTransactionView> {
    return this.resolutions.expense(id, input);
  }

  @Post(':id/payment')
  @RequirePermission('banking:manage')
  recordPayment(
    @Param('id') id: string,
    @Body() input: ResolvePaymentDto,
  ): Promise<BankTransactionView> {
    return this.resolutions.recordPayment(id, input);
  }
}
