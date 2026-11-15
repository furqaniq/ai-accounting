import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { RequirePermission } from '../tenant/require-permission.decorator';
import { BankTransactionMatchingService } from './bank-transaction-matching.service';
import { BankTransactionView } from './bank-transactions.service';
import { MatchSuggestion } from './matching-engine';
import { MatchTransactionDto } from './match-transaction.dto';

@Controller('bank-transactions')
export class BankTransactionMatchingController {
  constructor(private readonly matching: BankTransactionMatchingService) {}

  @Get(':id/suggestions')
  @RequirePermission('banking:read')
  suggestions(
    @Param('id') id: string,
  ): Promise<{ transactionId: string; suggestions: MatchSuggestion[] }> {
    return this.matching.suggestions(id);
  }

  @Post(':id/match')
  @RequirePermission('banking:manage')
  match(
    @Param('id') id: string,
    @Body() input: MatchTransactionDto,
  ): Promise<BankTransactionView> {
    return this.matching.match(id, input);
  }
}
