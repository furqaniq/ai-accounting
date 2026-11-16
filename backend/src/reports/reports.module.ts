import { Module } from '@nestjs/common';
import { TenantModule } from '../tenant/tenant.module';
import { ReportExportService } from './report-export.service';
import { ReportingEngine } from './reporting-engine';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [TenantModule],
  controllers: [ReportsController],
  providers: [ReportsService, ReportingEngine, ReportExportService],
})
export class ReportsModule {}
