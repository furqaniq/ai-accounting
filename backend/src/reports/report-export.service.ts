import { BadRequestException, Injectable } from '@nestjs/common';
import { TenantContextService } from '../tenant/tenant-context.service';
import { ExportQueryDto } from './reports.dto';
import {
  ExportableReport,
  ReportSlug,
  buildReportDocument,
  isReportSlug,
} from './report-export.document';
import { renderReportCsv } from './report-export.csv';
import { renderReportPdf } from './report-export.pdf';
import { ReportsService } from './reports.service';

const AS_OF_REPORTS = new Set<ReportSlug>(['balance-sheet', 'trial-balance']);

export interface ReportExportFile {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

@Injectable()
export class ReportExportService {
  constructor(
    private readonly tenant: TenantContextService,
    private readonly reports: ReportsService,
  ) {}

  async export(slug: string, query: ExportQueryDto): Promise<ReportExportFile> {
    if (!isReportSlug(slug)) {
      throw new BadRequestException(`Unknown report: ${slug}`);
    }
    if (AS_OF_REPORTS.has(slug)) {
      if (query.from || query.to) {
        throw new BadRequestException('from and to are not valid for this report');
      }
    } else if (query.asOf) {
      throw new BadRequestException('asOf is not valid for this report');
    }

    const { organizationName } = await this.tenant.get();
    const report = await this.load(slug, query);
    const document = buildReportDocument(report, organizationName, new Date().toISOString());
    const filename = this.filename(slug, report, query.format);

    if (query.format === 'csv') {
      return {
        buffer: Buffer.from(renderReportCsv(document), 'utf8'),
        filename,
        contentType: 'text/csv; charset=utf-8',
      };
    }

    return {
      buffer: await renderReportPdf(document),
      filename,
      contentType: 'application/pdf',
    };
  }

  private filename(slug: ReportSlug, report: ExportableReport, format: 'csv' | 'pdf'): string {
    const period =
      'asOf' in report ? report.asOf : `${report.from}_${report.to}`;
    return `${slug}-${period}.${format}`;
  }

  private load(slug: ReportSlug, query: ExportQueryDto): Promise<ExportableReport> {
    switch (slug) {
      case 'profit-loss':
        return this.reports.profitLoss(query);
      case 'balance-sheet':
        return this.reports.balanceSheet(query);
      case 'cash-flow':
        return this.reports.cashFlow(query);
      case 'trial-balance':
        return this.reports.trialBalance(query);
      case 'sales-by-customer':
        return this.reports.salesByCustomer(query);
      case 'sales-by-item':
        return this.reports.salesByItem(query);
      case 'expenses-by-category':
        return this.reports.expensesByCategory(query);
    }
  }
}
