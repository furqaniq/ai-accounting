import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { TenantModule } from '../tenant/tenant.module';
import { ArAgingController } from './ar-aging.controller';
import { ArAgingService } from './ar-aging.service';
import { CustomerBalanceService } from './customer-balance.service';
import { EstimatesController } from './estimates.controller';
import { EstimatesService } from './estimates.service';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';

@Module({
  imports: [TenantModule, LedgerModule],
  controllers: [
    CustomersController,
    ItemsController,
    InvoicesController,
    EstimatesController,
    PaymentsController,
    ArAgingController,
  ],
  providers: [
    ArAgingService,
    CustomerBalanceService,
    CustomersService,
    ItemsService,
    InvoicesService,
    InvoicePdfService,
    EstimatesService,
    PaymentsService,
  ],
  exports: [PaymentsService],
})
export class SalesModule {}
