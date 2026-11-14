import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { TenantModule } from '../tenant/tenant.module';
import { CustomerBalanceService } from './customer-balance.service';
import { EstimatesController } from './estimates.controller';
import { EstimatesService } from './estimates.service';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';

@Module({
  imports: [TenantModule, LedgerModule],
  controllers: [CustomersController, ItemsController, InvoicesController, EstimatesController],
  providers: [
    CustomerBalanceService,
    CustomersService,
    ItemsService,
    InvoicesService,
    InvoicePdfService,
    EstimatesService,
  ],
})
export class SalesModule {}
