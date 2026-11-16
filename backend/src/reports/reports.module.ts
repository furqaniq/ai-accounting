import { Module } from '@nestjs/common';
import { PurchasesModule } from '../purchases/purchases.module';
import { SalesModule } from '../sales/sales.module';
import { TenantModule } from '../tenant/tenant.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { ReportExportService } from './report-export.service';
import { ReportingEngine } from './reporting-engine';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [TenantModule, SalesModule, PurchasesModule],
  controllers: [ReportsController, DashboardController],
  providers: [ReportsService, ReportingEngine, ReportExportService, DashboardService],
})
export class ReportsModule {}
