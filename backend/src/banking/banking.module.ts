import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { TenantModule } from '../tenant/tenant.module';
import { BankAccountsController } from './bank-accounts.controller';
import { BankAccountsService } from './bank-accounts.service';
import { BankImportsController } from './bank-imports.controller';
import { BankImportService } from './bank-import.service';
import { BankTransactionsController } from './bank-transactions.controller';
import { BankTransactionsService } from './bank-transactions.service';
import { BankingImportEngine } from './banking-import.engine';
import { CategorizationRulesController } from './categorization-rules.controller';
import { CategorizationRulesService } from './categorization-rules.service';

@Module({
  imports: [TenantModule, LedgerModule],
  controllers: [
    BankAccountsController,
    BankTransactionsController,
    BankImportsController,
    CategorizationRulesController,
  ],
  providers: [
    BankingImportEngine,
    BankAccountsService,
    BankTransactionsService,
    BankImportService,
    CategorizationRulesService,
  ],
})
export class BankingModule {}
