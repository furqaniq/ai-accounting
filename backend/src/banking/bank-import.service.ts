import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AgentDomainEventType,
  BankAccount,
  BankImportBatch,
  BankImportFormat,
  BankTransaction,
  BankTransactionMatchState,
  JournalSourceType,
  Prisma,
} from '@prisma/client';
import { DomainEventsService } from '../events/domain-events.service';
import { LedgerEngine, toDate, toNumber } from '../ledger/ledger-engine';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../tenant/audit.service';
import { ScopedDataAccess } from '../tenant/scoped-data-access.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import {
  AppliedCategorizationRule,
  BankImportAnalysis,
  BankingImportEngine,
  CategorizationRuleCandidate,
  CsvMapping,
  CsvMappingInput,
} from './banking-import.engine';
import { BankImportConfirmDto, BankImportPreviewDto } from './bank-import.dto';

const MAX_BANK_FILE_BYTES = 10 * 1024 * 1024;
const RULE_TARGET_INCLUDE = {
  targetAccount: { select: { id: true, code: true, name: true, type: true } },
} as const;
const TRANSACTION_CATEGORY_INCLUDE = {
  categoryAccount: { select: { id: true, code: true, name: true } },
  categoryRule: { select: { id: true, descriptionContains: true } },
} as const;
type RuleRow = Prisma.CategorizationRuleGetPayload<{ include: typeof RULE_TARGET_INCLUDE }>;
type BankTransactionRow = Prisma.BankTransactionGetPayload<{
  include: typeof TRANSACTION_CATEGORY_INCLUDE;
}>;

export interface BankImportPreviewRow {
  rowNumber: number;
  date: string | null;
  description: string;
  amount: number | null;
  externalId: string | null;
  valid: boolean;
  duplicate: boolean;
  error: string | null;
  rule: AppliedCategorizationRule | null;
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
    categoryAccountId: string | null;
    categoryRuleId: string | null;
    categoryAccount: { id: string; code: string; name: string } | null;
    categoryRule: { id: string; descriptionContains: string } | null;
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
    private readonly ledger: LedgerEngine,
    private readonly events: DomainEventsService,
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
      await this.ruleCandidates(account),
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
      await this.ruleCandidates(account),
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
            matchState: row.rule
              ? BankTransactionMatchState.CATEGORIZED
              : BankTransactionMatchState.UNMATCHED,
            categoryAccountId: row.rule?.targetAccountId ?? null,
            categoryRuleId: row.rule?.id ?? null,
            raw: row.raw as Prisma.InputJsonObject,
          })),
          skipDuplicates: true,
        });
        importedCount = created.count;
        if (importedCount > 0) {
          const transactions = await tx.bankTransaction.findMany({
            where: { importBatchId: batch.id },
            orderBy: { createdAt: 'asc' },
          });
          await this.postRuleJournals(tx, organizationId, account, transactions, newRows);
        }
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
      categorizedCount: newRows.filter((row) => row.rule).length,
      duplicateCount: outcome.batch.duplicateCount,
      invalidCount: outcome.batch.invalidCount,
    });

    const transactions = await this.scoped.findMany<BankTransactionRow>('bankTransaction', {
      where: { importBatchId: outcome.batch.id },
      orderBy: { createdAt: 'asc' },
      include: TRANSACTION_CATEGORY_INCLUDE,
    });
    for (const transaction of transactions) {
      await this.events.publish({
        organizationId,
        type: AgentDomainEventType.BANK_TRANSACTION_IMPORTED,
        entityType: 'BankTransaction',
        entityId: transaction.id,
        data: {
          transactionId: transaction.id,
          bankAccountId: account.id,
          bankAccountName: account.name,
          date: transaction.date.toISOString().slice(0, 10),
          description: transaction.description,
          amount: toNumber(transaction.amount),
        },
      });
    }
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
        categoryAccountId: row.categoryAccountId,
        categoryRuleId: row.categoryRuleId,
        categoryAccount: row.categoryAccount,
        categoryRule: row.categoryRule,
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

  private async ruleCandidates(account: BankAccount): Promise<CategorizationRuleCandidate[]> {
    const rows = await this.scoped.findMany<RuleRow>('categorizationRule', {
      where: {
        active: true,
        targetAccountId: { not: account.ledgerAccountId },
        targetAccount: { is: { active: true } },
      },
      include: RULE_TARGET_INCLUDE,
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      descriptionContains: row.descriptionContains,
      priority: row.priority,
      createdAt: row.createdAt.toISOString(),
      active: row.active,
      targetAccountId: row.targetAccountId,
      targetAccount: row.targetAccount,
    }));
  }

  private async postRuleJournals(
    tx: Prisma.TransactionClient,
    organizationId: string,
    account: BankAccount,
    transactions: BankTransaction[],
    rows: BankImportAnalysis['rows'],
  ): Promise<void> {
    const rules = new Map(
      rows
        .filter((row) => row.rule && row.fingerprint)
        .map((row) => [row.fingerprint!, row.rule!] as const),
    );
    for (const transaction of transactions) {
      const rule = rules.get(transaction.fingerprint);
      if (!rule) continue;
      const amount = toNumber(transaction.amount);
      if (!amount) continue;
      const absolute = new Prisma.Decimal(Math.abs(amount).toFixed(2));
      const date = transaction.date.toISOString().slice(0, 10);
      const lines =
        amount > 0
          ? [
              { accountId: account.ledgerAccountId, debit: absolute },
              { accountId: rule.targetAccountId, credit: absolute },
            ]
          : [
              { accountId: rule.targetAccountId, debit: absolute },
              { accountId: account.ledgerAccountId, credit: absolute },
            ];
      await this.ledger.postWithin(tx, organizationId, {
        date,
        memo: `Bank rule "${rule.descriptionContains}" — ${transaction.description}`,
        sourceType: JournalSourceType.BANK,
        sourceId: transaction.id,
        lines,
      });
    }
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
        rule: row.rule,
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
