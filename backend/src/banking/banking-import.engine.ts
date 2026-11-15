import { BadRequestException, Injectable } from '@nestjs/common';
import { BankImportFormat } from '@prisma/client';
import { createHash } from 'node:crypto';

export interface BankFileInput {
  filename: string;
  buffer: Buffer;
}

export interface CsvMapping {
  date: string | null;
  description: string | null;
  amount: string | null;
  debit: string | null;
  credit: string | null;
  externalId: string | null;
}

export type CsvMappingField = keyof CsvMapping;
export type CsvMappingInput = Partial<Record<CsvMappingField, string | null | undefined>>;

export interface ImportCounts {
  total: number;
  valid: number;
  invalid: number;
  duplicate: number;
  newCount: number;
}

export interface AnalyzedBankRow {
  rowNumber: number;
  date: string | null;
  description: string;
  amount: number | null;
  externalId: string | null;
  fingerprint: string | null;
  raw: Record<string, string>;
  valid: boolean;
  duplicate: boolean;
  error: string | null;
}

export interface BankImportAnalysis {
  format: BankImportFormat;
  headers: string[];
  mapping: CsvMapping | null;
  mappingError: string | null;
  rows: AnalyzedBankRow[];
  counts: ImportCounts;
}

interface ParsedCsv {
  headers: string[];
  rows: Array<{ rowNumber: number; raw: Record<string, string> }>;
}

interface ParsedOfx {
  rows: Array<{ rowNumber: number; raw: Record<string, string> }>;
}

const MAPPING_FIELDS: CsvMappingField[] = [
  'date',
  'description',
  'amount',
  'debit',
  'credit',
  'externalId',
];

function emptyMapping(): CsvMapping {
  return {
    date: null,
    description: null,
    amount: null,
    debit: null,
    credit: null,
    externalId: null,
  };
}

function normalizeHeader(value: string): string {
  return value.trim().replace(/^\uFEFF/, '');
}

function autoMapHeaders(headers: string[]): CsvMapping {
  const mapping = emptyMapping();
  const lower = headers.map((header) => header.toLowerCase());
  const isDebit = (value: string) => /debit|withdrawal|money.?out|outflow/.test(value);
  const isCredit = (value: string) => /credit|deposit|money.?in|inflow/.test(value);

  mapping.date =
    headers.find((_, index) => /\b(date|posted|posting)\b/.test(lower[index])) ?? null;
  mapping.description =
    headers.find((_, index) => /description|memo|payee|narrative|details|particular/.test(lower[index])) ??
    null;
  mapping.amount =
    headers.find(
      (_, index) => /amount|value/.test(lower[index]) && !isDebit(lower[index]) && !isCredit(lower[index]),
    ) ?? null;
  mapping.debit = headers.find((_, index) => isDebit(lower[index])) ?? null;
  mapping.credit = headers.find((_, index) => isCredit(lower[index])) ?? null;
  mapping.externalId =
    headers.find(
      (_, index) =>
        /(transaction|bank|reference|ref|fit).*(id|no|number)/.test(lower[index]) ||
        /^(id|ref|reference)$/.test(lower[index]),
    ) ?? null;

  return mapping;
}

function mergeMapping(requested: CsvMappingInput, auto: CsvMapping): CsvMapping {
  const merged = { ...auto };
  for (const field of MAPPING_FIELDS) {
    const value = requested[field];
    if (typeof value === 'string' && value.trim()) {
      merged[field] = value;
    }
  }
  return merged;
}

function decodeOfxValue(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .trim();
}

function ofxTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i'));
  return match ? decodeOfxValue(match[1]) : '';
}

function detectFormat(file: BankFileInput): BankImportFormat {
  const name = file.filename.toLowerCase();
  if (name.endsWith('.ofx') || name.endsWith('.qfx')) return BankImportFormat.OFX;
  const head = file.buffer.subarray(0, 1024).toString('utf8').toUpperCase();
  if (head.includes('<OFX') || /\bOFXHEADER\b/.test(head)) return BankImportFormat.OFX;
  return BankImportFormat.CSV;
}

function detectDelimiter(text: string): string {
  const candidates = [',', ';', '\t'];
  const lines = text.split(/\r?\n/).filter((line) => line.trim()).slice(0, 5);
  let best = ',';
  let bestCount = -1;
  for (const delimiter of candidates) {
    let count = 0;
    for (const line of lines) {
      let quoted = false;
      for (const char of line) {
        if (char === '"') quoted = !quoted;
        else if (!quoted && char === delimiter) count += 1;
      }
    }
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return best;
}

function parseCsvRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((candidate) => candidate.some((cell) => cell.trim() !== ''));
}

function headerScore(row: string[]): number {
  const mapping = autoMapHeaders(row.map(normalizeHeader));
  return MAPPING_FIELDS.reduce((score, field) => score + (mapping[field] ? 1 : 0), 0);
}

function parseCsv(text: string): ParsedCsv {
  const cleaned = text.replace(/^\uFEFF/, '');
  if (!cleaned.trim()) throw new BadRequestException('The bank file is empty');
  const table = parseCsvRows(cleaned, detectDelimiter(cleaned));
  if (table.length === 0) throw new BadRequestException('The bank file has no rows');

  let headerIndex = 0;
  let bestScore = -1;
  for (let index = 0; index < Math.min(table.length, 10); index += 1) {
    const score = headerScore(table[index]);
    if (score > bestScore) {
      bestScore = score;
      headerIndex = index;
    }
  }
  if (bestScore < 2) headerIndex = 0;

  const headers = table[headerIndex].map(normalizeHeader);
  const rows: ParsedCsv['rows'] = [];
  for (let index = headerIndex + 1; index < table.length; index += 1) {
    const cells = table[index];
    const raw: Record<string, string> = {};
    headers.forEach((header, column) => {
      raw[header] = (cells[column] ?? '').trim();
    });
    rows.push({ rowNumber: rows.length + 1, raw });
  }
  if (rows.length === 0) throw new BadRequestException('The bank file has no transaction rows');
  return { headers, rows };
}

function parseOfx(text: string): ParsedOfx {
  const upper = text.toUpperCase();
  const rows: ParsedOfx['rows'] = [];
  let position = upper.indexOf('<STMTTRN>');
  if (position < 0) throw new BadRequestException('The OFX file has no transactions');

  while (position >= 0) {
    const next = upper.indexOf('<STMTTRN>', position + 1);
    const endCandidates = [next, upper.indexOf('</BANKTRANLIST>', position), upper.indexOf('</STMTRS>', position)]
      .filter((candidate) => candidate > position)
      .sort((a, b) => a - b);
    const end = endCandidates[0] ?? text.length;
    const block = text.slice(position, end);
    const name = ofxTag(block, 'NAME');
    const memo = ofxTag(block, 'MEMO');
    const payee = ofxTag(block, 'PAYEE');
    const parts = [name || payee, memo].filter(
      (part, index, all) => part && all.indexOf(part) === index,
    );
    rows.push({
      rowNumber: rows.length + 1,
      raw: {
        date: ofxTag(block, 'DTPOSTED'),
        description: parts.join(' — '),
        amount: ofxTag(block, 'TRNAMT'),
        externalId: ofxTag(block, 'FITID'),
        type: ofxTag(block, 'TRNTYPE'),
      },
    });
    position = next;
  }

  if (rows.length === 0) throw new BadRequestException('The OFX file has no transactions');
  return { rows };
}

function validDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

export function parseBankDate(value: string): string | null {
  const text = value.trim();
  if (!text) return null;

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const compact = text.match(/^(\d{4})(\d{2})(\d{2})/);
  if (compact) return validDate(Number(compact[1]), Number(compact[2]), Number(compact[3]));

  const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    const year = Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]);
    return validDate(year, Number(slash[1]), Number(slash[2]));
  }

  const ymdSlash = text.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (ymdSlash) {
    return validDate(Number(ymdSlash[1]), Number(ymdSlash[2]), Number(ymdSlash[3]));
  }
  return null;
}

export function parseBankAmount(value: string): number | null {
  let text = value.trim();
  if (!text) return null;
  let negative = false;
  if (text.startsWith('(') && text.endsWith(')')) {
    negative = true;
    text = text.slice(1, -1).trim();
  }
  const suffix = text.match(/\s*(CR|DR)$/i);
  if (suffix) {
    if (suffix[1].toUpperCase() === 'DR') negative = true;
    text = text.slice(0, suffix.index).trim();
  }
  text = text.replace(/[$€£,\s']/g, '');
  if (!/^[+-]?\d+(\.\d+)?$/.test(text)) return null;
  const amount = Number(text);
  if (!Number.isFinite(amount)) return null;
  const signed = negative ? -Math.abs(amount) : amount;
  const rounded = Math.round(signed * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function normalizeDescription(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function fingerprint(
  date: string | null,
  amount: number | null,
  description: string,
  externalId: string | null,
): string | null {
  if (!date || amount === null || !description) return null;
  const hash = createHash('sha256');
  if (externalId) {
    hash.update(`external|${externalId.trim().toLowerCase()}`);
  } else {
    hash.update(
      `row|${date}|${amount.toFixed(2)}|${description.toLowerCase().replace(/\s+/g, ' ')}`,
    );
  }
  return hash.digest('hex');
}

@Injectable()
export class BankingImportEngine {
  analyze(
    file: BankFileInput,
    requestedMapping: CsvMappingInput = {},
    existingFingerprints: Iterable<string> = [],
  ): BankImportAnalysis {
    if (!file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('The bank file is empty');
    }
    const format = detectFormat(file);
    const text = file.buffer.toString('utf8');
    const parsed = format === BankImportFormat.OFX ? parseOfx(text) : parseCsv(text);
    const headers = format === BankImportFormat.OFX ? [] : (parsed as ParsedCsv).headers;
    const auto = format === BankImportFormat.OFX ? null : autoMapHeaders(headers);
    const mapping = auto ? mergeMapping(requestedMapping, auto) : null;
    const mappingError = mapping ? this.mappingError(mapping, headers) : null;

    if (mappingError) {
      return {
        format,
        headers,
        mapping,
        mappingError,
        rows: [],
        counts: { total: 0, valid: 0, invalid: 0, duplicate: 0, newCount: 0 },
      };
    }

    const seen = new Set(existingFingerprints);
    const rows = parsed.rows.map((row) =>
      this.normalizeRow(row.rowNumber, row.raw, mapping, seen, format),
    );
    const valid = rows.filter((row) => row.valid).length;
    const duplicate = rows.filter((row) => row.valid && row.duplicate).length;
    return {
      format,
      headers,
      mapping,
      mappingError: null,
      rows,
      counts: {
        total: rows.length,
        valid,
        invalid: rows.length - valid,
        duplicate,
        newCount: valid - duplicate,
      },
    };
  }

  private mappingError(mapping: CsvMapping, headers: string[]): string | null {
    for (const field of MAPPING_FIELDS) {
      const column = mapping[field];
      if (column && !headers.includes(column)) {
        return `Column "${column}" was not found in the file.`;
      }
    }
    if (!mapping.date) return 'Choose the date column.';
    if (!mapping.description) return 'Choose the description column.';
    if (!mapping.amount && !mapping.debit && !mapping.credit) {
      return 'Choose an amount column, or a debit and credit column.';
    }
    return null;
  }

  private normalizeRow(
    rowNumber: number,
    raw: Record<string, string>,
    mapping: CsvMapping | null,
    seen: Set<string>,
    format: BankImportFormat,
  ): AnalyzedBankRow {
    const dateValue = mapping ? raw[mapping.date ?? ''] ?? '' : raw.date ?? '';
    const descriptionValue = mapping
      ? raw[mapping.description ?? ''] ?? ''
      : raw.description ?? '';
    let amount: number | null;
    if (mapping?.amount) {
      amount = parseBankAmount(raw[mapping.amount] ?? '');
    } else if (mapping) {
      const debitRaw = mapping.debit ? raw[mapping.debit] ?? '' : '';
      const creditRaw = mapping.credit ? raw[mapping.credit] ?? '' : '';
      if (!debitRaw.trim() && !creditRaw.trim()) {
        amount = null;
      } else {
        const debit = Math.abs(parseBankAmount(debitRaw) ?? 0);
        const credit = Math.abs(parseBankAmount(creditRaw) ?? 0);
        amount = Math.round((credit - debit) * 100) / 100;
      }
    } else {
      amount = parseBankAmount(raw.amount ?? '');
    }
    const externalId = mapping
      ? mapping.externalId
        ? (raw[mapping.externalId] ?? '').trim() || null
        : null
      : (raw.externalId ?? '').trim() || null;

    const date = parseBankDate(dateValue);
    const description = normalizeDescription(descriptionValue);
    const errors: string[] = [];
    if (!date) errors.push('Missing or invalid date');
    if (!description) errors.push('Missing description');
    if (amount === null) errors.push('Missing or invalid amount');

    const fp = fingerprint(date, amount, description, externalId);
    const duplicate = Boolean(fp && seen.has(fp));
    if (fp && !duplicate) seen.add(fp);
    return {
      rowNumber,
      date,
      description,
      amount,
      externalId,
      fingerprint: fp,
      raw: { ...raw, sourceFormat: format },
      valid: errors.length === 0,
      duplicate,
      error: errors.length > 0 ? errors.join('; ') : null,
    };
  }
}
