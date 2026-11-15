import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BankTransaction,
  BankTransactionMatchState,
  BillStatus,
  InvoiceStatus,
  PaymentDirection,
  Prisma,
} from '@prisma/client';
import { toNumber } from '../ledger/ledger-engine';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../tenant/audit.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { BankTransactionView, BankTransactionsService } from './bank-transactions.service';
import { MatchEntityType, MatchSuggestion, MatchingEngine } from './matching-engine';
import { MatchTransactionDto } from './match-transaction.dto';

interface MatchTarget {
  entityType: MatchEntityType;
  entityId: string;
  number: string;
  label: string;
}

@Injectable()
export class BankTransactionMatchingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly transactions: BankTransactionsService,
    private readonly engine: MatchingEngine,
  ) {}

  async suggestions(
    id: string,
  ): Promise<{ transactionId: string; suggestions: MatchSuggestion[] }> {
    const transaction = await this.transactions.find(id);
    if (
      transaction.matchState !== BankTransactionMatchState.UNMATCHED ||
      transaction.resolvedAt
    ) {
      throw new ConflictException('That transaction is already matched or resolved');
    }
    const suggestions = await this.engine.suggest({
      date: new Date(`${transaction.date}T00:00:00.000Z`),
      description: transaction.description,
      amount: transaction.amount,
    });
    return { transactionId: transaction.id, suggestions };
  }

  async match(id: string, input: MatchTransactionDto): Promise<BankTransactionView> {
    const { organizationId } = await this.tenant.get();
    const outcome = await this.prisma.$transaction(async (tx) => {
      const transaction = await this.lockTransaction(tx, organizationId, id);
      const amount = this.amount(transaction);
      this.assertDirection(input.entityType, amount);
      const target = await this.resolveTarget(
        tx,
        organizationId,
        input.entityType,
        input.entityId,
      );
      await tx.bankTransaction.update({
        where: { id: transaction.id },
        data: {
          matchState: BankTransactionMatchState.MATCHED,
          categoryAccountId: null,
          categoryRuleId: null,
          matchedEntityType: target.entityType,
          matchedEntityId: target.entityId,
          resolutionLabel: target.label,
          resolvedAt: new Date(),
        },
      });
      return {
        description: transaction.description,
        amount: Math.abs(amount),
        entityType: target.entityType,
        number: target.number,
        label: target.label,
      };
    });

    await this.audit.record('bank.transaction.match', 'BankTransaction', id, {
      description: outcome.description,
      amount: outcome.amount,
      entityType: outcome.entityType,
      number: outcome.number,
    });
    return this.transactions.find(id);
  }

  private async lockTransaction(
    tx: Prisma.TransactionClient,
    organizationId: string,
    id: string,
  ): Promise<BankTransaction> {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM "BankTransaction"
      WHERE "organizationId" = ${organizationId} AND id = ${id}
      FOR UPDATE
    `);
    if (locked.length === 0) throw new NotFoundException('Bank transaction not found');
    const transaction = await tx.bankTransaction.findFirst({
      where: { id, organizationId },
    });
    if (!transaction) throw new NotFoundException('Bank transaction not found');
    if (
      transaction.matchState !== BankTransactionMatchState.UNMATCHED ||
      transaction.resolvedAt
    ) {
      throw new ConflictException('That transaction is already matched or resolved');
    }
    return transaction;
  }

  private amount(transaction: BankTransaction): number {
    const amount = toNumber(transaction.amount);
    if (amount === 0) {
      throw new BadRequestException('A zero-amount transaction cannot be matched');
    }
    return amount;
  }

  private assertDirection(type: MatchEntityType, amount: number): void {
    const deposit = amount > 0;
    if (deposit && (type === MatchEntityType.BILL || type === MatchEntityType.EXPENSE)) {
      throw new BadRequestException('Deposits match invoices or customer payments');
    }
    if (!deposit && (type === MatchEntityType.INVOICE || type === MatchEntityType.PAYMENT)) {
      throw new BadRequestException('Withdrawals match bills or expenses');
    }
  }

  private async resolveTarget(
    tx: Prisma.TransactionClient,
    organizationId: string,
    type: MatchEntityType,
    id: string,
  ): Promise<MatchTarget> {
    if (type === MatchEntityType.INVOICE) {
      const invoice = await tx.invoice.findFirst({
        where: {
          id,
          organizationId,
          status: { in: [InvoiceStatus.SENT, InvoiceStatus.PARTIAL] },
        },
        include: { customer: { select: { name: true } } },
      });
      if (!invoice) throw new NotFoundException('Open invoice not found');
      return {
        entityType: type,
        entityId: invoice.id,
        number: invoice.number,
        label: `${invoice.number} · ${invoice.customer.name}`,
      };
    }

    if (type === MatchEntityType.BILL) {
      const bill = await tx.bill.findFirst({
        where: {
          id,
          organizationId,
          status: { in: [BillStatus.OPEN, BillStatus.PARTIAL] },
        },
        include: { vendor: { select: { name: true } } },
      });
      if (!bill) throw new NotFoundException('Open bill not found');
      return {
        entityType: type,
        entityId: bill.id,
        number: bill.number,
        label: `${bill.number} · ${bill.vendor.name}`,
      };
    }

    if (type === MatchEntityType.PAYMENT) {
      const payment = await tx.payment.findFirst({
        where: { id, organizationId, direction: PaymentDirection.RECEIVED },
        include: { customer: { select: { name: true } } },
      });
      if (!payment) throw new NotFoundException('Customer payment not found');
      return {
        entityType: type,
        entityId: payment.id,
        number: payment.number,
        label: `${payment.number} · ${payment.customer.name}`,
      };
    }

    const expense = await tx.expense.findFirst({
      where: { id, organizationId },
      include: { categoryAccount: { select: { name: true } } },
    });
    if (!expense) throw new NotFoundException('Expense not found');
    return {
      entityType: type,
      entityId: expense.id,
      number: expense.number,
      label: `${expense.number} · ${expense.categoryAccount.name}`,
    };
  }
}
