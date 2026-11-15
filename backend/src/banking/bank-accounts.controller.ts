import { Body, Controller, Get, Post } from '@nestjs/common';
import { RequirePermission } from '../tenant/require-permission.decorator';
import { CreateBankAccountDto } from './bank-account.dto';
import { BankAccountView, BankAccountsService } from './bank-accounts.service';

@Controller('bank-accounts')
export class BankAccountsController {
  constructor(private readonly accounts: BankAccountsService) {}

  @Get()
  @RequirePermission('banking:read')
  async list(): Promise<{ bankAccounts: BankAccountView[] }> {
    return { bankAccounts: await this.accounts.list() };
  }

  @Post()
  @RequirePermission('banking:manage')
  create(@Body() input: CreateBankAccountDto): Promise<BankAccountView> {
    return this.accounts.create(input);
  }
}
