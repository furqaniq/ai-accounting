import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { InvoiceView } from './invoices.service';

const INK = '#13231c';
const SOFT = '#5d6b63';
const RULE = '#c9cec4';
const LEDGER = '#1f5a43';
const PAPER = '#f7f5ed';

function money(value: number): string {
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function displayDate(value: string): string {
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function statusLabel(status: InvoiceView['status']): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

@Injectable()
export class InvoicePdfService {
  async render(invoice: InvoiceView, organizationName: string): Promise<Buffer> {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: `Invoice ${invoice.number}`,
        Author: organizationName,
        Subject: `Invoice for ${invoice.customer.name}`,
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
    let y = 54;

    doc.fillColor(INK).font('Helvetica-Bold').fontSize(20).text(organizationName, left, y);
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(SOFT)
      .text('Invoice', left, y + 26);
    doc
      .font('Helvetica-Bold')
      .fontSize(18)
      .fillColor(INK)
      .text(invoice.number, 360, y, { width: 185, align: 'right' });
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(SOFT)
      .text(statusLabel(invoice.status), 360, y + 26, { width: 185, align: 'right' });

    y += 54;
    doc.moveTo(left, y).lineTo(right, y).lineWidth(1.2).strokeColor(LEDGER).stroke();

    y += 18;
    doc.fillColor(SOFT).font('Helvetica-Bold').fontSize(8).text('BILL TO', left, y);
    doc.text('INVOICE DETAILS', 360, y, { width: 185, align: 'right' });

    y += 14;
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(invoice.customer.name, left, y);
    const meta = [
      `Issued  ${displayDate(invoice.issueDate)}`,
      `Due     ${displayDate(invoice.dueDate)}`,
    ];
    meta.forEach((line, index) => {
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor(INK)
        .text(line, 360, y + index * 13, { width: 185, align: 'right' });
    });

    y += 17;
    const customerLines = [
      invoice.customer.contactName,
      invoice.customer.addressLine1,
      invoice.customer.addressLine2,
      [invoice.customer.city, invoice.customer.region, invoice.customer.postalCode]
        .filter(Boolean)
        .join(', ') || null,
      invoice.customer.country,
      invoice.customer.email,
      invoice.customer.phone,
    ].filter((line): line is string => Boolean(line));
    if (customerLines.length > 0) {
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor(SOFT)
        .text(customerLines.join('\n'), left, y, { width: 260, lineGap: 2 });
      y += Math.max(customerLines.length * 12, 24);
    }

    y = Math.max(y + 20, 210);
    doc
      .rect(left, y, right - left, 22)
      .fillColor(PAPER)
      .fill();
    doc.fillColor(SOFT).font('Helvetica-Bold').fontSize(8);
    doc.text('DESCRIPTION', left + 8, y + 7);
    doc.text('QTY', 330, y + 7, { width: 40, align: 'right' });
    doc.text('RATE', 392, y + 7, { width: 60, align: 'right' });
    doc.text('AMOUNT', 470, y + 7, { width: 67, align: 'right' });
    y += 30;

    for (const line of invoice.lines) {
      const height = Math.max(
        22,
        doc.heightOfString(line.description, { width: 250 }) + 14,
      );
      if (y + height > 700) {
        doc.addPage();
        y = 54;
      }
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(9.5).text(line.description, left + 8, y, {
        width: 250,
      });
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(SOFT)
        .text(line.item.code, left + 8, y + 13, { width: 250 });
      doc.fillColor(INK).font('Helvetica').fontSize(9.5);
      doc.text(String(line.quantity), 330, y, { width: 40, align: 'right' });
      doc.text(money(line.unitPrice), 392, y, { width: 60, align: 'right' });
      doc.text(money(line.amount), 470, y, { width: 67, align: 'right' });
      y += height;
      doc.moveTo(left, y - 4).lineTo(right, y - 4).lineWidth(0.5).strokeColor(RULE).stroke();
    }

    y += 10;
    const totalRow = (label: string, value: string, bold = false) => {
      if (y > 710) {
        doc.addPage();
        y = 54;
      }
      doc
        .fillColor(bold ? INK : SOFT)
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(bold ? 10.5 : 9)
        .text(label, 350, y, { width: 100, align: 'right' });
      doc
        .fillColor(INK)
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(bold ? 10.5 : 9)
        .text(value, 455, y, { width: 90, align: 'right' });
      y += bold ? 17 : 14;
    };

    totalRow('Subtotal', money(invoice.subtotal));
    totalRow(`Tax (${(invoice.taxRate * 100).toFixed(2)}%)`, money(invoice.taxTotal));
    y += 3;
    doc.moveTo(350, y).lineTo(right, y).lineWidth(1).strokeColor(INK).stroke();
    y += 7;
    totalRow('Total', money(invoice.total), true);
    if (invoice.amountPaid > 0) {
      totalRow('Paid', money(invoice.amountPaid));
      totalRow('Balance due', money(invoice.balanceDue), true);
    } else {
      totalRow('Balance due', money(invoice.balanceDue));
    }

    y += 14;
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(SOFT)
      .text(`Payment due by ${displayDate(invoice.dueDate)}.`, left, y, { width: right - left });

    if (invoice.notes) {
      y += 22;
      if (y > 700) {
        doc.addPage();
        y = 54;
      }
      doc.fillColor(SOFT).font('Helvetica-Bold').fontSize(8).text('NOTES', left, y);
      doc
        .fillColor(INK)
        .font('Helvetica')
        .fontSize(9)
        .text(invoice.notes, left, y + 12, { width: right - left });
    }

    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(SOFT)
      .text('Generated by Daybook', left, 790, { width: right - left, align: 'center' });

    doc.end();
    return finished;
  }
}
