import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { SalesModule } from '../sales/sales.module';
import { TenantModule } from '../tenant/tenant.module';
import { ProjectsController, TimeEntriesController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [TenantModule, LedgerModule, SalesModule],
  controllers: [ProjectsController, TimeEntriesController],
  providers: [ProjectsService],
})
export class ProjectsModule {}
