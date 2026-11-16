import { Controller, Get, Param, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { RequirePermission } from '../tenant/require-permission.decorator';
import { AsOfQueryDto, ExportQueryDto, PeriodQueryDto } from './reports.dto';
import { ReportExportService } from './report-export.service';
import { ReportsService } from './reports.service';
import {
  BalanceSheetReport,
  CashFlowReport,
  ExpensesByCategoryReport,
  ProfitLossReport,
  SalesByCustomerReport,
  SalesByItemReport,
  TrialBalanceReport,
} from './reporting-engine';

@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly exportService: ReportExportService,
  ) {}

  @Get(':report/export')
  @RequirePermission('reports:read')
  async exportReport(
    @Param('report') report: string,
    @Query() query: ExportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.exportService.export(report, query);
    res.set({
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      'Content-Length': String(file.buffer.length),
    });
    return new StreamableFile(file.buffer);
  }

  @Get('profit-loss')
  @RequirePermission('reports:read')
  profitLoss(@Query() query: PeriodQueryDto): Promise<ProfitLossReport> {
    return this.reports.profitLoss(query);
  }

  @Get('balance-sheet')
  @RequirePermission('reports:read')
  balanceSheet(@Query() query: AsOfQueryDto): Promise<BalanceSheetReport> {
    return this.reports.balanceSheet(query);
  }

  @Get('cash-flow')
  @RequirePermission('reports:read')
  cashFlow(@Query() query: PeriodQueryDto): Promise<CashFlowReport> {
    return this.reports.cashFlow(query);
  }

  @Get('trial-balance')
  @RequirePermission('reports:read')
  trialBalance(@Query() query: AsOfQueryDto): Promise<TrialBalanceReport> {
    return this.reports.trialBalance(query);
  }

  @Get('sales-by-customer')
  @RequirePermission('reports:read')
  salesByCustomer(@Query() query: PeriodQueryDto): Promise<SalesByCustomerReport> {
    return this.reports.salesByCustomer(query);
  }

  @Get('sales-by-item')
  @RequirePermission('reports:read')
  salesByItem(@Query() query: PeriodQueryDto): Promise<SalesByItemReport> {
    return this.reports.salesByItem(query);
  }

  @Get('expenses-by-category')
  @RequirePermission('reports:read')
  expensesByCategory(@Query() query: PeriodQueryDto): Promise<ExpensesByCategoryReport> {
    return this.reports.expensesByCategory(query);
  }
}
