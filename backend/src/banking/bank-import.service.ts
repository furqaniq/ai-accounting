import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BankAccount,
  BankImportBatch,
  BankImportFormat,
  BankTransaction,
  BankTransactionMatchState,
  Prisma,
} from '@prisma/client';
import { toDate, toNumber } from '../ledger/ledger-engine';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../tenant/audit.service';
import { ScopedDataAccess } from '../tenant/scoped-data-access.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import {
  BankImportAnalysis,
  BankingImportEngine,
  CsvMapping,
  CsvMappingInput,
} from './banking-import.engine';
import { BankImportConfirmDto, BankImportPreviewDto } from './bank-import.dto';

const MAX_BANK_FILE_BYTES = 10 * 1024 * 1024;

export interface BankImportPreviewRow {
  rowNumber: number;
  date: string | null;
  description: string;
  amount: number | null;
  externalId: string | null;
  valid: boolean;
  duplicate: boolean;
  error: string | null;
}

export interface BankImportPreview {
  filename: string;
  format: BankImportFormat;
  headers: string[];
  mapping: CsvMapping | null;
  mappingError: string | null;
  rows: BankImportPreviewRow[];
  counts: BankImportAnalysis['counts'];
}

export interface BankImportBatchView {
  id: string;
  bankAccountId: string;
  filename: string;
  format: BankImportFormat;
  rowCount: number;
  importedCount: number;
  duplicateCount: number;
  invalidCount: number;
  createdAt: string;
}

export interface BankImportConfirmResult {
  batch: BankImportBatchView;
  transactions: Array<{
    id: string;
    bankAccountId: string;
    importBatchId: string;
    date: string;
    description: string;
    amount: number;
    externalId: string | null;
    matchState: BankTransactionMatchState;
    createdAt: string;
  }>;
}

function cleanFilename(filename: string): string {
  const base = filename.replace(/\\/g, '/').split('/').pop()?.trim() ?? '';
  return (base || 'bank-import').slice(0, 200);
}

function mappingFromDto(input: BankImportPreviewDto): CsvMappingInput {
  return {
    date: input.dateColumn ?? null,
    description: input.descriptionColumn ?? null,
    amount: input.amountColumn ?? null,
    debit: input.debitColumn ?? null,
    credit: input.creditColumn ?? null,
    externalId: input.externalIdColumn ?? null,
  };
}

@Injectable()
export class BankImportService {
  constructor(
    private readonly scoped: ScopedDataAccess,
    private readonly tenant: TenantContextService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly engine: BankingImportEngine,
  ) {}

  async preview(
    file: Express.Multer.File | undefined,
    input: BankImportPreviewDto,
  ): Promise<BankImportPreview> {
    const account = await this.findAccount(input.bankAccountId);
    const analysis = this.engine.analyze(
      this.fileInput(file),
      mappingFromDto(input),
      await this.existingFingerprints(account.id),
    );
    return this.previewView(file, analysis);
  }

  async import(
    file: Express.Multer.File | undefined,
    input: BankImportConfirmDto,
  ): Promise<BankImportConfirmResult> {
    const account = await this.findAccount(input.bankAccountId);
    const analysis = this.engine.analyze(
      this.fileInput(file),
      mappingFromDto(input),
      await this.existingFingerprints(account.id),
    );
    if (analysis.mappingError) throw new BadRequestException(analysis.mappingError);
    if (analysis.counts.valid === 0) {
      throw new BadRequestException('No valid bank transactions were found in that file');
    }

    const { organizationId } = await this.tenant.get();
    const newRows = analysis.rows.filter((row) => row.valid && !row.duplicate);
    const filename = cleanFilename(file?.originalname ?? 'bank-import');

    const outcome = await this.prisma.$transaction(async (tx) => {
      const batch = await tx.bankImportBatch.create({
        data: {
          organizationId,
          bankAccountId: account.id,
          filename,
          format: analysis.format,
          rowCount: analysis.counts.total,
          invalidCount: analysis.counts.invalid,
        },
      });

      let importedCount = 0;
      if (newRows.length > 0) {
        const created = await tx.bankTransaction.createMany({
          data: newRows.map((row) => ({
            organizationId,
            bankAccountId: account.id,
            importBatchId: batch.id,
            date: toDate(row.date!, 'date'),
            description: row.description,
            amount: new Prisma.Decimal(row.amount!),
            externalId: row.externalId,
            fingerprint: row.fingerprint!,
            raw: row.raw as Prisma.InputJsonObject,
          })),
          skipDuplicates: true,
        });
        importedCount = created.count;
      }

      const duplicateCount =
        analysis.counts.total - analysis.counts.invalid - importedCount;
      const updated = await tx.bankImportBatch.update({
        where: { id: batch.id },
        data: { importedCount, duplicateCount },
      });
      return { batch: updated, importedCount };
    });

    await this.audit.record('bank.import', 'BankImportBatch', outcome.batch.id, {
      bankAccount: account.name,
      filename,
      format: analysis.format,
      importedCount: outcome.importedCount,
      duplicateCount: outcome.batch.duplicateCount,
      invalidCount: outcome.batch.invalidCount,
    });

    const transactions = await this.scoped.findMany<BankTransaction>('bankTransaction', {
      where: { importBatchId: outcome.batch.id },
      orderBy: { createdAt: 'asc' },
    });
    return {
      batch: this.batchView(outcome.batch),
      transactions: transactions.map((row) => ({
        id: row.id,
        bankAccountId: row.bankAccountId,
        importBatchId: row.importBatchId,
        date: row.date.toISOString().slice(0, 10),
        description: row.description,
        amount: toNumber(row.amount),
        externalId: row.externalId,
        matchState: row.matchState,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  private async findAccount(id: string): Promise<BankAccount> {
    const account = await this.scoped.findById<BankAccount>('bankAccount', id, {
      select: {
        id: true,
        organizationId: true,
        name: true,
        type: true,
        ledgerAccountId: true,
        active: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!account) throw new NotFoundException('Bank account not found');
    return account;
  }

  private async existingFingerprints(bankAccountId: string): Promise<Set<string>> {
    const rows = await this.scoped.findMany<{ fingerprint: string }>('bankTransaction', {
      where: { bankAccountId },
      select: { fingerprint: true },
    });
    return new Set(rows.map((row) => row.fingerprint));
  }

  private fileInput(file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException('Choose a bank file to import');
    if (!file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('The bank file is empty');
    }
    if (file.size > MAX_BANK_FILE_BYTES) {
      throw new BadRequestException('Bank files must be 10 MB or smaller');
    }
    return { filename: file.originalname, buffer: file.buffer };
  }

  private previewView(
    file: Express.Multer.File | undefined,
    analysis: BankImportAnalysis,
  ): BankImportPreview {
    return {
      filename: cleanFilename(file?.originalname ?? 'bank-import'),
      format: analysis.format,
      headers: analysis.headers,
      mapping: analysis.mapping,
      mappingError: analysis.mappingError,
      rows: analysis.rows.map((row) => ({
        rowNumber: row.rowNumber,
        date: row.date,
        description: row.description,
        amount: row.amount,
        externalId: row.externalId,
        valid: row.valid,
        duplicate: row.duplicate,
        error: row.error,
      })),
      counts: analysis.counts,
    };
  }

  private batchView(batch: BankImportBatch): BankImportBatchView {
    return {
      id: batch.id,
      bankAccountId: batch.bankAccountId,
      filename: batch.filename,
      format: batch.format,
      rowCount: batch.rowCount,
      importedCount: batch.importedCount,
      duplicateCount: batch.duplicateCount,
      invalidCount: batch.invalidCount,
      createdAt: batch.createdAt.toISOString(),
    };
  }
}
