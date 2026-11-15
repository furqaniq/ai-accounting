import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountType,
  BankAccountType,
  Prisma,
  ReconciliationStatus,
} from '@prisma/client';
import { accountBalance, toDate, toNumber } from '../ledger/ledger-engine';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../tenant/audit.service';
import { ScopedDataAccess } from '../tenant/scoped-data-access.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { BankTransactionView, BankTransactionsService } from './bank-transactions.service';
import {
  CreateReconciliationDto,
  ListReconciliationsDto,
} from './reconciliation.dto';
import {
  ReconciliationDirection,
  summarizeReconciliation,
} from './reconciliation-engine';

const SESSION_INCLUDE = {
  bankAccount: {
    select: {
      id: true,
      name: true,
      type: true,
      active: true,
      ledgerAccount: {
        select: { id: true, code: true, name: true, type: true, active: true },
      },
    },
  },
} as const;

type SessionRow = Prisma.ReconciliationSessionGetPayload<{
  include: typeof SESSION_INCLUDE;
}>;

export interface ReconciliationSessionView {
  id: string;
  bankAccountId: string;
  bankAccount: {
    id: string;
    name: string;
    type: BankAccountType;
    active: boolean;
    ledgerAccount: {
      id: string;
      code: string;
      name: string;
      type: AccountType;
      active: boolean;
    };
  };
  periodStart: string;
  periodEnd: string;
  statementEndingBalance: number;
  openingBalance: number;
  clearedTotal: number;
  clearedBalance: number;
  bookBalance: number;
  difference: number;
  balanced: boolean;
  status: ReconciliationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ReconciliationTransactionView extends BankTransactionView {
  cleared: boolean;
  clearedElsewhere: boolean;
}

export interface ReconciliationDetailView extends ReconciliationSessionView {
  clearedCount: number;
  transactionCount: number;
  transactions: ReconciliationTransactionView[];
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function dayBefore(value: Date): string {
  return new Date(value.getTime() - 86_400_000).toISOString().slice(0, 10);
}

@Injectable()
export class ReconciliationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scoped: ScopedDataAccess,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly transactions: BankTransactionsService,
  ) {}

  async list(filters: ListReconciliationsDto): Promise<ReconciliationSessionView[]> {
    const where: Record<string, unknown> = {};
    if (filters.bankAccountId) where.bankAccountId = filters.bankAccountId;
    if (filters.status) where.status = filters.status;
    const rows = await this.scoped.findMany<SessionRow>('reconciliationSession', {
      where,
      include: SESSION_INCLUDE,
      orderBy: [{ periodEnd: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });
    return rows.map((row) => this.toView(row));
  }

  async find(id: string): Promise<ReconciliationDetailView> {
    const session = await this.scoped.findById<SessionRow>('reconciliationSession', id, {
      include: SESSION_INCLUDE,
    });
    if (!session) throw new NotFoundException('Reconciliation session not found');

    const rows = await this.transactions.list({
      bankAccountId: session.bankAccountId,
      from: session.periodStart.toISOString().slice(0, 10),
      to: session.periodEnd.toISOString().slice(0, 10),
    });
    const transactions = rows.map((row) => ({
      ...row,
      cleared: row.reconciliationSessionId === session.id,
      clearedElsewhere:
        row.reconciliationSessionId !== null &&
        row.reconciliationSessionId !== session.id,
    }));
    return {
      ...this.toView(session),
      clearedCount: transactions.filter((row) => row.cleared).length,
      transactionCount: transactions.length,
      transactions,
    };
  }

  async start(input: CreateReconciliationDto): Promise<ReconciliationDetailView> {
    const { organizationId } = await this.tenant.get();
    const periodStart = toDate(input.periodStart, 'periodStart');
    const periodEnd = toDate(input.periodEnd, 'periodEnd');
    if (periodStart > periodEnd) {
      throw new BadRequestException('The period start must be on or before the period end');
    }

    let sessionId: string;
    try {
      sessionId = await this.prisma.$transaction(async (tx) => {
        const bankAccount = await tx.bankAccount.findFirst({
          where: { id: input.bankAccountId, organizationId, active: true },
          include: {
            ledgerAccount: {
              select: { id: true, type: true, active: true },
            },
          },
        });
        if (!bankAccount) throw new NotFoundException('Bank account not found');
        if (!bankAccount.ledgerAccount.active) {
          throw new BadRequestException('The linked ledger account is inactive');
        }

        const duplicate = await tx.reconciliationSession.findFirst({
          where: {
            organizationId,
            bankAccountId: bankAccount.id,
            periodStart,
            periodEnd,
          },
          select: { id: true },
        });
        if (duplicate) {
          throw new ConflictException('A reconciliation already exists for that account and period');
        }

        const opening = await accountBalance(tx, organizationId, bankAccount.ledgerAccountId, {
          asOf: dayBefore(periodStart),
        });
        const book = await accountBalance(tx, organizationId, bankAccount.ledgerAccountId, {
          asOf: input.periodEnd,
        });
        const summary = summarizeReconciliation({
          statementEndingBalance: input.statementEndingBalance,
          openingBalance: opening.balance,
          bookBalance: book.balance,
          direction: this.direction(bankAccount.ledgerAccount.type),
          transactions: [],
        });
        const created = await tx.reconciliationSession.create({
          data: {
            organizationId,
            bankAccountId: bankAccount.id,
            periodStart,
            periodEnd,
            statementEndingBalance: new Prisma.Decimal(
              input.statementEndingBalance.toFixed(2),
            ),
            openingBalance: new Prisma.Decimal(summary.openingBalance.toFixed(2)),
            clearedTotal: new Prisma.Decimal(summary.clearedTotal.toFixed(2)),
            bookBalance: new Prisma.Decimal(summary.bookBalance.toFixed(2)),
            difference: new Prisma.Decimal(summary.difference.toFixed(2)),
          },
        });
        return created.id;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A reconciliation already exists for that account and period',
        );
      }
      throw error;
    }

    const session = await this.find(sessionId);
    await this.audit.record('reconciliation.start', 'ReconciliationSession', sessionId, {
      bankAccount: session.bankAccount.name,
      periodStart: session.periodStart,
      periodEnd: session.periodEnd,
      statementEndingBalance: session.statementEndingBalance,
    });
    return session;
  }

  async setCleared(
    sessionId: string,
    transactionId: string,
    cleared: boolean,
  ): Promise<ReconciliationDetailView> {
    const { organizationId } = await this.tenant.get();
    const outcome = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM "ReconciliationSession"
        WHERE "organizationId" = ${organizationId} AND id = ${sessionId}
        FOR UPDATE
      `);
      if (locked.length === 0) {
        throw new NotFoundException('Reconciliation session not found');
      }
      const session = await tx.reconciliationSession.findFirst({
        where: { id: sessionId, organizationId },
        include: {
          bankAccount: {
            select: {
              id: true,
              ledgerAccountId: true,
              ledgerAccount: { select: { type: true } },
            },
          },
        },
      });
      if (!session) throw new NotFoundException('Reconciliation session not found');
      if (session.status !== ReconciliationStatus.ACTIVE) {
        throw new ConflictException('That reconciliation is no longer editable');
      }

      const transaction = await tx.bankTransaction.findFirst({
        where: {
          id: transactionId,
          organizationId,
          bankAccountId: session.bankAccountId,
          date: { gte: session.periodStart, lte: session.periodEnd },
        },
      });
      if (!transaction) {
        throw new NotFoundException('Bank transaction not found in this period');
      }
      if (
        transaction.reconciliationSessionId &&
        transaction.reconciliationSessionId !== session.id
      ) {
        throw new ConflictException(
          'That transaction is already cleared in another reconciliation',
        );
      }
      if (!cleared && transaction.reconciliationSessionId !== session.id) {
        throw new BadRequestException('That transaction is not cleared in this session');
      }

      await tx.bankTransaction.update({
        where: { id: transaction.id },
        data: cleared
          ? {
              reconciliationSessionId: session.id,
              clearedAt: transaction.clearedAt ?? new Date(),
            }
          : { reconciliationSessionId: null, clearedAt: null },
      });

      const rows = await tx.bankTransaction.findMany({
        where: {
          organizationId,
          bankAccountId: session.bankAccountId,
          date: { gte: session.periodStart, lte: session.periodEnd },
        },
        select: { amount: true, reconciliationSessionId: true },
      });
      const book = await accountBalance(
        tx,
        organizationId,
        session.bankAccount.ledgerAccountId,
        { asOf: session.periodEnd.toISOString().slice(0, 10) },
      );
      const summary = summarizeReconciliation({
        statementEndingBalance: toNumber(session.statementEndingBalance),
        openingBalance: toNumber(session.openingBalance),
        bookBalance: book.balance,
        direction: this.direction(session.bankAccount.ledgerAccount.type),
        transactions: rows.map((row) => ({
          amount: toNumber(row.amount),
          cleared: row.reconciliationSessionId === session.id,
        })),
      });
      await tx.reconciliationSession.update({
        where: { id: session.id },
        data: {
          clearedTotal: new Prisma.Decimal(summary.clearedTotal.toFixed(2)),
          bookBalance: new Prisma.Decimal(summary.bookBalance.toFixed(2)),
          difference: new Prisma.Decimal(summary.difference.toFixed(2)),
        },
      });
      return {
        description: transaction.description,
        amount: toNumber(transaction.amount),
      };
    });

    await this.audit.record(
      cleared ? 'reconciliation.clear' : 'reconciliation.unclear',
      'ReconciliationSession',
      sessionId,
      {
        transactionId,
        description: outcome.description,
        amount: outcome.amount,
      },
    );
    return this.find(sessionId);
  }

  private direction(type: AccountType): ReconciliationDirection {
    return type === AccountType.LIABILITY ? 'CREDIT' : 'DEBIT';
  }

  private toView(row: SessionRow): ReconciliationSessionView {
    const opening = toNumber(row.openingBalance);
    const clearedTotal = toNumber(row.clearedTotal);
    const clearedBalance = roundMoney(opening + clearedTotal);
    const difference = toNumber(row.difference);
    return {
      id: row.id,
      bankAccountId: row.bankAccountId,
      bankAccount: row.bankAccount,
      periodStart: row.periodStart.toISOString().slice(0, 10),
      periodEnd: row.periodEnd.toISOString().slice(0, 10),
      statementEndingBalance: toNumber(row.statementEndingBalance),
      openingBalance: opening,
      clearedTotal,
      clearedBalance,
      bookBalance: toNumber(row.bookBalance),
      difference,
      balanced: difference === 0,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
