import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { TenantModule } from '../tenant/tenant.module';
import { BillsController } from './bills.controller';
import { BillsService } from './bills.service';
import { VendorBalanceService } from './vendor-balance.service';
import { VendorsController } from './vendors.controller';
import { VendorsService } from './vendors.service';

@Module({
  imports: [TenantModule, LedgerModule],
  controllers: [VendorsController, BillsController],
  providers: [VendorBalanceService, VendorsService, BillsService],
})
export class PurchasesModule {}
