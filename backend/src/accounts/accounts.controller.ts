import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Account } from '@prisma/client';
import { RequirePermission } from '../tenant/require-permission.decorator';
import { CreateAccountDto, ListAccountsDto, UpdateAccountDto } from './account.dto';
import { AccountsService } from './accounts.service';

@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  @RequirePermission('accounts:read')
  async list(@Query() query: ListAccountsDto): Promise<{ accounts: Account[] }> {
    return { accounts: await this.accounts.list(query) };
  }

  @Post()
  @RequirePermission('accounts:manage')
  create(@Body() input: CreateAccountDto): Promise<Account> {
    return this.accounts.create(input);
  }

  @Patch(':id')
  @RequirePermission('accounts:manage')
  update(@Param('id') id: string, @Body() input: UpdateAccountDto): Promise<Account> {
    return this.accounts.update(id, input);
  }
}
