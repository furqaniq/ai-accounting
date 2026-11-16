import {
  BalanceSheetReport,
  CashFlowReport,
  ExpensesByCategoryReport,
  ProfitLossReport,
  SalesByCustomerReport,
  SalesByItemReport,
  TrialBalanceReport,
} from './reporting-engine';

export type ExportableReport =
  | ProfitLossReport
  | BalanceSheetReport
  | CashFlowReport
  | TrialBalanceReport
  | SalesByCustomerReport
  | SalesByItemReport
  | ExpensesByCategoryReport;

export type ReportSlug = ExportableReport['report'];

export type ExportColumnType = 'text' | 'money' | 'number';

export type ExportCell = string | number | null;

export interface ExportColumn {
  label: string;
  type: ExportColumnType;
}

export interface ExportSection {
  title: string;
  columns: ExportColumn[];
  rows: ExportCell[][];
  total?: ExportCell[];
}

export interface ExportSummaryRow {
  label: string;
  value: string;
}

export interface ReportDocument {
  organization: string;
  title: string;
  generatedAt: string;
  period:
    | { kind: 'period'; from: string; to: string }
    | { kind: 'asOf'; asOf: string };
  sections: ExportSection[];
  summary: ExportSummaryRow[];
  notes: string[];
}

export const REPORT_TITLES: Record<ReportSlug, string> = {
  'profit-loss': 'Profit & loss',
  'balance-sheet': 'Balance sheet',
  'cash-flow': 'Cash flow statement',
  'trial-balance': 'Trial balance',
  'sales-by-customer': 'Sales by customer',
  'sales-by-item': 'Sales by item',
  'expenses-by-category': 'Expenses by category',
};

export function isReportSlug(value: string): value is ReportSlug {
  return value in REPORT_TITLES;
}

export function moneyValue(value: number): string {
  return value.toFixed(2);
}

export function numberValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function cellText(cell: ExportCell, type: ExportColumnType): string {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'number') {
    return type === 'money' ? moneyValue(cell) : numberValue(cell);
  }
  return String(cell);
}

function accountColumns(): ExportColumn[] {
  return [
    { label: 'Account', type: 'text' },
    { label: 'Code', type: 'text' },
    { label: 'Amount', type: 'money' },
  ];
}

function statementSections(
  groups: Array<{ label: string; accounts: Array<{ code: string | null; name: string; amount: number }>; total: number }>,
): ExportSection[] {
  return groups.map((group) => ({
    title: group.label,
    columns: accountColumns(),
    rows: group.accounts.map((account) => [account.name, account.code, account.amount]),
    total: [`Total ${group.label.toLowerCase()}`, '', group.total],
  }));
}

function base(report: ExportableReport, organization: string, generatedAt: string): ReportDocument {
  return {
    organization,
    title: REPORT_TITLES[report.report],
    generatedAt,
    period:
      'asOf' in report
        ? { kind: 'asOf', asOf: report.asOf }
        : { kind: 'period', from: report.from, to: report.to },
    sections: [],
    summary: [],
    notes: [],
  };
}

export function buildReportDocument(
  report: ExportableReport,
  organization: string,
  generatedAt: string,
): ReportDocument {
  const doc = base(report, organization, generatedAt);

  if (report.report === 'profit-loss') {
    doc.sections = statementSections(report.groups);
    doc.summary = [
      { label: 'Total income', value: moneyValue(report.totalIncome) },
      { label: 'Total expenses', value: moneyValue(report.totalExpenses) },
      { label: 'Net income', value: moneyValue(report.netIncome) },
    ];
    return doc;
  }

  if (report.report === 'balance-sheet') {
    doc.sections = statementSections(report.groups);
    doc.summary = [
      { label: 'Total assets', value: moneyValue(report.totalAssets) },
      { label: 'Total liabilities', value: moneyValue(report.totalLiabilities) },
      { label: 'Total equity', value: moneyValue(report.totalEquity) },
      {
        label: 'Total liabilities and equity',
        value: moneyValue(report.totalLiabilitiesAndEquity),
      },
    ];
    doc.notes = [
      report.balanced
        ? 'Assets equal liabilities and equity.'
        : 'Assets do not equal liabilities and equity.',
    ];
    return doc;
  }

  if (report.report === 'trial-balance') {
    doc.sections = [
      {
        title: 'Accounts',
        columns: [
          { label: 'Account', type: 'text' },
          { label: 'Code', type: 'text' },
          { label: 'Debit', type: 'money' },
          { label: 'Credit', type: 'money' },
        ],
        rows: report.rows.map((row) => [
          row.name,
          row.code,
          row.debit === 0 ? null : row.debit,
          row.credit === 0 ? null : row.credit,
        ]),
        total: ['Totals', '', report.totalDebit, report.totalCredit],
      },
    ];
    doc.summary = [
      { label: 'Total debits', value: moneyValue(report.totalDebit) },
      { label: 'Total credits', value: moneyValue(report.totalCredit) },
    ];
    doc.notes = [
      report.debitsEqualCredits ? 'Debits equal credits.' : 'Debits do not equal credits.',
    ];
    return doc;
  }

  if (report.report === 'cash-flow') {
    doc.sections = report.groups.map((group) => ({
      title: group.label,
      columns: [
        { label: 'Counterpart account', type: 'text' },
        { label: 'Code', type: 'text' },
        { label: 'Movement', type: 'money' },
      ],
      rows: group.lines.map((line) => [line.name, line.code, line.amount]),
      total: [`Net ${group.label.toLowerCase()}`, '', group.total],
    }));
    doc.summary = [
      { label: 'Beginning cash', value: moneyValue(report.beginningCash) },
      { label: 'Net change', value: moneyValue(report.netChange) },
      { label: 'Ending cash', value: moneyValue(report.endingCash) },
    ];
    doc.notes = [
      report.reconciled
        ? 'Beginning cash plus net movement equals ending cash.'
        : 'Beginning cash plus net movement does not equal ending cash.',
    ];
    return doc;
  }

  if (report.report === 'sales-by-customer') {
    doc.sections = [
      {
        title: 'Sales by customer',
        columns: [
          { label: 'Customer', type: 'text' },
          { label: 'Code', type: 'text' },
          { label: 'Documents', type: 'number' },
          { label: 'Quantity', type: 'number' },
          { label: 'Sales', type: 'money' },
          { label: 'Tax', type: 'money' },
          { label: 'Total', type: 'money' },
        ],
        rows: report.rows.map((row) => [
          row.name,
          row.code,
          row.count,
          row.quantity,
          row.amount,
          row.tax,
          row.total,
        ]),
        total: [
          'Total sales',
          '',
          report.totals.count,
          report.totals.quantity,
          report.totals.amount,
          report.totals.tax,
          report.totals.total,
        ],
      },
      {
        title: 'Source documents',
        columns: [
          { label: 'Document', type: 'text' },
          { label: 'Date', type: 'text' },
          { label: 'Customer', type: 'text' },
          { label: 'Quantity', type: 'number' },
          { label: 'Sales', type: 'money' },
          { label: 'Tax', type: 'money' },
          { label: 'Total', type: 'money' },
        ],
        rows: report.rows.flatMap((row) =>
          row.sources.map((source) => [
            source.number,
            source.date,
            row.name,
            source.quantity,
            source.amount,
            source.tax,
            source.total,
          ]),
        ),
      },
    ];
    doc.summary = [
      { label: 'Pre-tax sales', value: moneyValue(report.totals.amount) },
      { label: 'Tax collected', value: moneyValue(report.totals.tax) },
      { label: 'Invoiced total', value: moneyValue(report.totals.total) },
      { label: 'Ledger income', value: moneyValue(report.ledgerIncome) },
      { label: 'Status', value: report.reconciled ? 'Reconciled' : 'Does not tie to the ledger' },
    ];
    return doc;
  }

  if (report.report === 'sales-by-item') {
    doc.sections = [
      {
        title: 'Sales by item',
        columns: [
          { label: 'Item', type: 'text' },
          { label: 'Code', type: 'text' },
          { label: 'Lines', type: 'number' },
          { label: 'Quantity', type: 'number' },
          { label: 'Sales', type: 'money' },
        ],
        rows: report.rows.map((row) => [
          row.name,
          row.code,
          row.count,
          row.quantity,
          row.amount,
        ]),
        total: [
          'Total sales',
          '',
          report.totals.count,
          report.totals.quantity,
          report.totals.amount,
        ],
      },
      {
        title: 'Source documents',
        columns: [
          { label: 'Document', type: 'text' },
          { label: 'Date', type: 'text' },
          { label: 'Item', type: 'text' },
          { label: 'Quantity', type: 'number' },
          { label: 'Sales', type: 'money' },
        ],
        rows: report.rows.flatMap((row) =>
          row.sources.map((source) => [
            source.number,
            source.date,
            row.name,
            source.quantity,
            source.amount,
          ]),
        ),
      },
    ];
    doc.summary = [
      { label: 'Pre-tax sales', value: moneyValue(report.totals.amount) },
      { label: 'Quantity sold', value: numberValue(report.totals.quantity) },
      { label: 'Invoice lines', value: numberValue(report.totals.count) },
      { label: 'Ledger income', value: moneyValue(report.ledgerIncome) },
      { label: 'Status', value: report.reconciled ? 'Reconciled' : 'Does not tie to the ledger' },
    ];
    return doc;
  }

  doc.sections = [
    {
      title: 'Expenses by category',
      columns: [
        { label: 'Category', type: 'text' },
        { label: 'Code', type: 'text' },
        { label: 'Documents', type: 'number' },
        { label: 'Expense', type: 'money' },
      ],
      rows: report.rows.map((row) => [row.name, row.code, row.count, row.amount]),
      total: ['Total expenses', '', report.totals.count, report.totals.amount],
    },
    {
      title: 'Source documents',
      columns: [
        { label: 'Document', type: 'text' },
        { label: 'Type', type: 'text' },
        { label: 'Date', type: 'text' },
        { label: 'Party', type: 'text' },
        { label: 'Memo', type: 'text' },
        { label: 'Amount', type: 'money' },
      ],
      rows: report.rows.flatMap((row) =>
        row.sources.map((source) => [
          source.number,
          source.type === 'bill' ? 'Bill' : 'Expense',
          source.date,
          source.party,
          source.memo,
          source.amount,
        ]),
      ),
    },
  ];
  doc.summary = [
    { label: 'Total expenses', value: moneyValue(report.totals.amount) },
    { label: 'Documents', value: numberValue(report.totals.count) },
    { label: 'Ledger expenses', value: moneyValue(report.ledgerExpenses) },
    { label: 'Status', value: report.reconciled ? 'Reconciled' : 'Does not tie to the ledger' },
  ];
  return doc;
}
