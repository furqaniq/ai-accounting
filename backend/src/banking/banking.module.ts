import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { PurchasesModule } from '../purchases/purchases.module';
import { SalesModule } from '../sales/sales.module';
import { TenantModule } from '../tenant/tenant.module';
import { BankAccountsController } from './bank-accounts.controller';
import { BankAccountsService } from './bank-accounts.service';
import { BankImportsController } from './bank-imports.controller';
import { BankImportService } from './bank-import.service';
import { BankTransactionsController } from './bank-transactions.controller';
import { BankTransactionsService } from './bank-transactions.service';
import { BankTransactionMatchingController } from './bank-transaction-matching.controller';
import { BankTransactionMatchingService } from './bank-transaction-matching.service';
import { BankTransactionResolutionController } from './bank-transaction-resolution.controller';
import { BankTransactionResolutionService } from './bank-transaction-resolution.service';
import { BankingImportEngine } from './banking-import.engine';
import { CategorizationRulesController } from './categorization-rules.controller';
import { CategorizationRulesService } from './categorization-rules.service';
import { MatchingEngine } from './matching-engine';

@Module({
  imports: [TenantModule, LedgerModule, PurchasesModule, SalesModule],
  controllers: [
    BankAccountsController,
    BankTransactionsController,
    BankTransactionResolutionController,
    BankTransactionMatchingController,
    BankImportsController,
    CategorizationRulesController,
  ],
  providers: [
    BankingImportEngine,
    BankAccountsService,
    BankTransactionsService,
    BankTransactionResolutionService,
    BankTransactionMatchingService,
    MatchingEngine,
    BankImportService,
    CategorizationRulesService,
  ],
})
export class BankingModule {}
