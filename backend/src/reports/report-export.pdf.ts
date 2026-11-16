import PDFDocument from 'pdfkit';
import {
  ExportCell,
  ExportColumn,
  ExportColumnType,
  ReportDocument,
} from './report-export.document';

const INK = '#13231c';
const SOFT = '#5d6b63';
const RULE = '#c9cec4';
const LEDGER = '#1f5a43';
const PAPER = '#f7f5ed';

function pdfMoney(value: number): string {
  const sign = value < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function pdfNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function cellText(cell: ExportCell, type: ExportColumnType): string {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'number') {
    return type === 'money' ? pdfMoney(cell) : pdfNumber(cell);
  }
  return String(cell);
}

function displayDate(value: string): string {
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function periodLabel(doc: ReportDocument): string {
  return doc.period.kind === 'asOf'
    ? `As of ${displayDate(doc.period.asOf)}`
    : `${displayDate(doc.period.from)} - ${displayDate(doc.period.to)}`;
}

function layout(columns: ExportColumn[], width: number): {
  widths: number[];
  aligns: Array<'left' | 'right'>;
} {
  const count = columns.length;
  const numericWidth = count <= 2 ? 100 : count === 3 ? 90 : count === 4 ? 80 : 60;
  const firstWidth = width - numericWidth * (count - 1);
  return {
    widths: columns.map((_, index) => (index === 0 ? firstWidth : numericWidth)),
    aligns: columns.map((column) => (column.type === 'text' ? 'left' : 'right')),
  };
}

/**
 * Renders the shared report document as a Daybook-style PDF: organization and
 * report identity on top, ruled section tables with right-aligned amounts,
 * subtotal/total rules, a summary block, and page breaks for long reports.
 */
export async function renderReportPdf(report: ReportDocument): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 50,
    info: {
      Title: report.title,
      Author: report.organization,
      Subject: periodLabel(report),
      Creator: 'Daybook',
    },
  });
  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const left = 50;
  const right = 545;
  const width = right - left;
  let y = 54;

  const ensure = (space: number): void => {
    if (y + space > 760) {
      doc.addPage();
      y = 54;
    }
  };

  doc.fillColor(INK).font('Helvetica-Bold').fontSize(18).text(report.organization, left, y, {
    width: 300,
  });
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(SOFT)
    .text(`Generated ${displayDate(report.generatedAt.slice(0, 10))}`, 345, y + 4, {
      width: 200,
      align: 'right',
    });

  y += 28;
  doc.fillColor(LEDGER).font('Helvetica-Bold').fontSize(14).text(report.title, left, y);
  y += 20;
  doc.fillColor(SOFT).font('Helvetica').fontSize(9).text(periodLabel(report), left, y);
  y += 14;
  doc.moveTo(left, y).lineTo(right, y).lineWidth(1.2).strokeColor(LEDGER).stroke();
  y += 18;

  for (const section of report.sections) {
    ensure(44);
    doc
      .fillColor(LEDGER)
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(section.title.toUpperCase(), left, y);
    y += 14;

    const { widths, aligns } = layout(section.columns, width);
    doc.rect(left, y, width, 16).fillColor(PAPER).fill();
    let x = left;
    section.columns.forEach((column, index) => {
      doc
        .fillColor(SOFT)
        .font('Helvetica-Bold')
        .fontSize(7.5)
        .text(column.label.toUpperCase(), x + 4, y + 5, {
          width: widths[index] - 8,
          align: aligns[index],
        });
      x += widths[index];
    });
    y += 16;
    doc.moveTo(left, y).lineTo(right, y).lineWidth(0.6).strokeColor(RULE).stroke();

    if (section.rows.length === 0) {
      ensure(16);
      doc.fillColor(SOFT).font('Helvetica').fontSize(9).text('No activity', left + 4, y + 3);
      y += 16;
    } else {
      for (const row of section.rows) {
        ensure(15);
        x = left;
        section.columns.forEach((column, index) => {
          doc
            .fillColor(index === 0 ? INK : SOFT)
            .font('Helvetica')
            .fontSize(index === 0 ? 9 : 8.5)
            .text(cellText(row[index], column.type), x + 4, y + 2, {
              width: widths[index] - 8,
              align: aligns[index],
              ellipsis: true,
            });
          x += widths[index];
        });
        y += 14;
        doc.moveTo(left, y - 2).lineTo(right, y - 2).lineWidth(0.4).strokeColor(RULE).stroke();
      }
    }

    if (section.total) {
      ensure(26);
      doc.moveTo(left, y + 2).lineTo(right, y + 2).lineWidth(1).strokeColor(INK).stroke();
      y += 6;
      x = left;
      section.columns.forEach((column, index) => {
        doc
          .fillColor(INK)
          .font('Helvetica-Bold')
          .fontSize(index === 0 ? 9.5 : 9)
          .text(cellText(section.total![index], column.type), x + 4, y + 2, {
            width: widths[index] - 8,
            align: aligns[index],
            ellipsis: true,
          });
        x += widths[index];
      });
      y += 18;
    }

    y += 10;
  }

  if (report.summary.length > 0) {
    ensure(46);
    doc.fillColor(LEDGER).font('Helvetica-Bold').fontSize(10).text('SUMMARY', left, y);
    y += 14;
    doc.moveTo(left, y).lineTo(right, y).lineWidth(0.8).strokeColor(RULE).stroke();
    y += 2;
    for (const row of report.summary) {
      ensure(14);
      doc.fillColor(SOFT).font('Helvetica').fontSize(9).text(row.label, left, y + 2, {
        width: 300,
      });
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text(row.value, right - 200, y + 2, {
        width: 200,
        align: 'right',
      });
      y += 13;
    }
  }

  if (report.notes.length > 0) {
    y += 10;
    ensure(30);
    doc
      .fillColor(SOFT)
      .font('Helvetica')
      .fontSize(8.5)
      .text(report.notes.join('\n'), left, y, { width, lineGap: 2 });
  }

  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(SOFT)
    .text('Generated by Daybook', left, 790, { width, align: 'center' });

  doc.end();
  return finished;
}
