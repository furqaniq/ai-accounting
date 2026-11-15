import { Module } from '@nestjs/common';
import { TenantModule } from '../tenant/tenant.module';
import { BankAccountsController } from './bank-accounts.controller';
import { BankAccountsService } from './bank-accounts.service';
import { BankImportsController } from './bank-imports.controller';
import { BankImportService } from './bank-import.service';
import { BankTransactionsController } from './bank-transactions.controller';
import { BankTransactionsService } from './bank-transactions.service';
import { BankingImportEngine } from './banking-import.engine';

@Module({
  imports: [TenantModule],
  controllers: [
    BankAccountsController,
    BankTransactionsController,
    BankImportsController,
  ],
  providers: [
    BankingImportEngine,
    BankAccountsService,
    BankTransactionsService,
    BankImportService,
  ],
})
export class BankingModule {}
