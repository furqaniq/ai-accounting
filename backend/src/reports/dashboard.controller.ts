import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermission } from '../tenant/require-permission.decorator';
import { DashboardReport, DashboardService } from './dashboard.service';
import { PeriodQueryDto } from './reports.dto';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @RequirePermission('reports:read')
  report(@Query() query: PeriodQueryDto): Promise<DashboardReport> {
    return this.dashboard.report(query);
  }
}
