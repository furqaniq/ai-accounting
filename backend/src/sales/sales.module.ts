import { Module } from '@nestjs/common';
import { TenantModule } from '../tenant/tenant.module';
import { CustomerBalanceService } from './customer-balance.service';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';

@Module({
  imports: [TenantModule],
  controllers: [CustomersController, ItemsController],
  providers: [CustomerBalanceService, CustomersService, ItemsService],
})
export class SalesModule {}
