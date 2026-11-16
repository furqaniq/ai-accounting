import { ExportCell, ReportDocument, cellText } from './report-export.document';

function escapeField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function csvPeriod(doc: ReportDocument): string {
  return doc.period.kind === 'asOf'
    ? `As of ${doc.period.asOf}`
    : `${doc.period.from} to ${doc.period.to}`;
}

/**
 * Renders the shared report document as RFC 4180 CSV: metadata first, then
 * each section with its own columns, and a final label/value summary. Amounts
 * are plain two-decimal numbers so spreadsheets read them as values.
 */
export function renderReportCsv(doc: ReportDocument): string {
  const lines: string[][] = [
    ['Organization', doc.organization],
    ['Report', doc.title],
    ['Period', csvPeriod(doc)],
    ['Generated', doc.generatedAt],
    [],
  ];

  for (const section of doc.sections) {
    lines.push([section.title]);
    lines.push(section.columns.map((column) => column.label));
    for (const row of section.rows) {
      lines.push(row.map((cell, index) => cellText(cell, section.columns[index].type)));
    }
    if (section.total) {
      lines.push(
        section.total.map((cell: ExportCell, index) =>
          cellText(cell, section.columns[index].type),
        ),
      );
    }
    lines.push([]);
  }

  lines.push(['Summary']);
  lines.push(['Label', 'Value']);
  for (const row of doc.summary) {
    lines.push([row.label, row.value]);
  }

  if (doc.notes.length > 0) {
    lines.push([]);
    lines.push(['Notes']);
    for (const note of doc.notes) {
      lines.push([note]);
    }
  }

  return `${lines.map((line) => line.map(escapeField).join(',')).join('\r\n')}\r\n`;
}
