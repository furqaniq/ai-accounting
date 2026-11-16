import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { TenantModule } from '../tenant/tenant.module';
import { ApAgingController } from './ap-aging.controller';
import { ApAgingService } from './ap-aging.service';
import { BillPaymentsController } from './bill-payments.controller';
import { BillPaymentsService } from './bill-payments.service';
import { BillsController } from './bills.controller';
import { BillsService } from './bills.service';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';
import { VendorBalanceService } from './vendor-balance.service';
import { VendorsController } from './vendors.controller';
import { VendorsService } from './vendors.service';

@Module({
  imports: [TenantModule, LedgerModule],
  controllers: [
    VendorsController,
    BillsController,
    BillPaymentsController,
    ExpensesController,
    ApAgingController,
  ],
  providers: [
    VendorBalanceService,
    VendorsService,
    BillsService,
    BillPaymentsService,
    ExpensesService,
    ApAgingService,
  ],
  exports: [ApAgingService, ExpensesService],
})
export class PurchasesModule {}
