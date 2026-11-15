import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Account,
  BankTransaction,
  BankTransactionMatchState,
  JournalSourceType,
  Prisma,
} from '@prisma/client';
import { LedgerEngine, toNumber } from '../ledger/ledger-engine';
import { CreateExpenseDto } from '../purchases/expense.dto';
import { ExpensesService } from '../purchases/expenses.service';
import { CreatePaymentDto } from '../sales/payment.dto';
import { PaymentsService } from '../sales/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../tenant/audit.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { BankTransactionView, BankTransactionsService } from './bank-transactions.service';
import {
  ResolveCategorizationDto,
  ResolveExpenseDto,
  ResolvePaymentDto,
  ResolveTransferDto,
} from './resolve-transaction.dto';

type TransactionWithAccount = BankTransaction & {
  bankAccount: { id: string; name: string; ledgerAccountId: string; active: boolean };
};

@Injectable()
export class BankTransactionResolutionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly ledger: LedgerEngine,
    private readonly audit: AuditService,
    private readonly transactions: BankTransactionsService,
    private readonly expenses: ExpensesService,
    private readonly payments: PaymentsService,
  ) {}

  async categorize(id: string, input: ResolveCategorizationDto): Promise<BankTransactionView> {
    const { organizationId } = await this.tenant.get();
    const outcome = await this.prisma.$transaction(async (tx) => {
      const transaction = await this.lockTransaction(tx, organizationId, id);
      const amount = this.amount(transaction);
      const account = await this.resolveAccount(tx, organizationId, input.accountId);
      if (account.id === transaction.bankAccount.ledgerAccountId) {
        throw new BadRequestException('Choose an account other than this bank account');
      }
      const label = `${account.code} ${account.name}`;
      await this.postJournal(tx, organizationId, transaction, amount, account.id);
      await tx.bankTransaction.update({
        where: { id: transaction.id },
        data: {
          matchState: BankTransactionMatchState.CATEGORIZED,
          categoryAccountId: account.id,
          matchedEntityType: 'ACCOUNT',
          matchedEntityId: account.id,
          resolutionLabel: label,
          resolvedAt: new Date(),
        },
      });
      return { label, amount: Math.abs(amount), description: transaction.description };
    });

    await this.audit.record('bank.transaction.categorize', 'BankTransaction', id, {
      description: outcome.description,
      amount: outcome.amount,
      account: outcome.label,
    });
    return this.transactions.find(id);
  }

  async transfer(id: string, input: ResolveTransferDto): Promise<BankTransactionView> {
    const { organizationId } = await this.tenant.get();
    const outcome = await this.prisma.$transaction(async (tx) => {
      const transaction = await this.lockTransaction(tx, organizationId, id);
      const amount = this.amount(transaction);
      if (input.bankAccountId === transaction.bankAccountId) {
        throw new BadRequestException('Choose a different bank account to transfer to');
      }
      const target = await tx.bankAccount.findFirst({
        where: { id: input.bankAccountId, organizationId, active: true },
        include: {
          ledgerAccount: { select: { id: true, code: true, name: true, active: true } },
        },
      });
      if (!target) throw new NotFoundException('Target bank account not found');
      if (!target.ledgerAccount.active) {
        throw new BadRequestException('Target bank account ledger is inactive');
      }
      await this.postJournal(tx, organizationId, transaction, amount, target.ledgerAccountId);
      const label = `Transfer to ${target.name}`;
      await tx.bankTransaction.update({
        where: { id: transaction.id },
        data: {
          matchState: BankTransactionMatchState.MATCHED,
          categoryAccountId: target.ledgerAccountId,
          matchedEntityType: 'BANK_ACCOUNT',
          matchedEntityId: target.id,
          resolutionLabel: label,
          resolvedAt: new Date(),
        },
      });
      return {
        label,
        amount: Math.abs(amount),
        description: transaction.description,
        targetBankAccount: target.name,
        targetLedger: `${target.ledgerAccount.code} ${target.ledgerAccount.name}`,
      };
    });

    await this.audit.record('bank.transaction.transfer', 'BankTransaction', id, {
      description: outcome.description,
      amount: outcome.amount,
      resolution: outcome.label,
      targetBankAccount: outcome.targetBankAccount,
      targetLedger: outcome.targetLedger,
    });
    return this.transactions.find(id);
  }

  async expense(id: string, input: ResolveExpenseDto): Promise<BankTransactionView> {
    const { organizationId } = await this.tenant.get();
    const outcome = await this.prisma.$transaction(async (tx) => {
      const transaction = await this.lockTransaction(tx, organizationId, id);
      const amount = this.amount(transaction);
      if (amount > 0) {
        throw new BadRequestException('Expenses must be paid out of the bank account');
      }
      const expenseInput: CreateExpenseDto = {
        date: transaction.date.toISOString().slice(0, 10),
        amount: Math.abs(amount),
        categoryAccountId: input.categoryAccountId,
        vendorId: input.vendorId,
        memo: input.memo?.trim() || transaction.description,
      };
      const expense = await this.expenses.createFromBankTransaction(
        tx,
        organizationId,
        expenseInput,
        transaction.bankAccount.ledgerAccountId,
      );
      await tx.bankTransaction.update({
        where: { id: transaction.id },
        data: {
          matchState: BankTransactionMatchState.MATCHED,
          categoryAccountId: expense.categoryAccountId,
          matchedEntityType: 'EXPENSE',
          matchedEntityId: expense.id,
          resolutionLabel: expense.number,
          resolvedAt: new Date(),
        },
      });
      return {
        number: expense.number,
        amount: Math.abs(amount),
        description: transaction.description,
        category: `${expense.categoryAccount.code} ${expense.categoryAccount.name}`,
      };
    });

    await this.audit.record('bank.transaction.expense', 'BankTransaction', id, {
      description: outcome.description,
      amount: outcome.amount,
      number: outcome.number,
      category: outcome.category,
    });
    return this.transactions.find(id);
  }

  async recordPayment(id: string, input: ResolvePaymentDto): Promise<BankTransactionView> {
    const { organizationId } = await this.tenant.get();
    const outcome = await this.prisma.$transaction(async (tx) => {
      const transaction = await this.lockTransaction(tx, organizationId, id);
      const amount = this.amount(transaction);
      if (amount < 0) {
        throw new BadRequestException('Customer payments must be deposited into the bank account');
      }
      const paymentInput: CreatePaymentDto = {
        customerId: input.customerId,
        date: transaction.date.toISOString().slice(0, 10),
        amount: Math.abs(amount),
        method: 'BANK_TRANSFER',
        reference: input.reference?.trim() || transaction.description.slice(0, 100),
        notes: input.notes,
        applications: input.applications,
      };
      const payment = await this.payments.createFromBankTransaction(
        tx,
        organizationId,
        paymentInput,
        transaction.bankAccount.ledgerAccountId,
      );
      await tx.bankTransaction.update({
        where: { id: transaction.id },
        data: {
          matchState: BankTransactionMatchState.MATCHED,
          categoryAccountId: null,
          matchedEntityType: 'PAYMENT',
          matchedEntityId: payment.id,
          resolutionLabel: payment.number,
          resolvedAt: new Date(),
        },
      });
      return {
        number: payment.number,
        amount: Math.abs(amount),
        description: transaction.description,
        customerId: input.customerId,
      };
    });

    await this.audit.record('bank.transaction.payment', 'BankTransaction', id, {
      description: outcome.description,
      amount: outcome.amount,
      number: outcome.number,
      customerId: outcome.customerId,
    });
    return this.transactions.find(id);
  }

  private async lockTransaction(
    tx: Prisma.TransactionClient,
    organizationId: string,
    id: string,
  ): Promise<TransactionWithAccount> {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM "BankTransaction"
      WHERE "organizationId" = ${organizationId} AND id = ${id}
      FOR UPDATE
    `);
    if (locked.length === 0) throw new NotFoundException('Bank transaction not found');
    const transaction = await tx.bankTransaction.findFirst({
      where: { id, organizationId },
      include: {
        bankAccount: {
          select: { id: true, name: true, ledgerAccountId: true, active: true },
        },
      },
    });
    if (!transaction) throw new NotFoundException('Bank transaction not found');
    if (
      transaction.matchState !== BankTransactionMatchState.UNMATCHED ||
      transaction.resolvedAt
    ) {
      throw new ConflictException('That transaction is already resolved');
    }
    return transaction;
  }

  private amount(transaction: BankTransaction): number {
    const amount = toNumber(transaction.amount);
    if (amount === 0) throw new BadRequestException('A zero-amount transaction cannot be resolved');
    return amount;
  }

  private async resolveAccount(
    tx: Prisma.TransactionClient,
    organizationId: string,
    id: string,
  ): Promise<Pick<Account, 'id' | 'code' | 'name'>> {
    const account = await tx.account.findFirst({
      where: { id, organizationId, active: true },
      select: { id: true, code: true, name: true },
    });
    if (!account) throw new NotFoundException('Account not found');
    return account;
  }

  private async postJournal(
    tx: Prisma.TransactionClient,
    organizationId: string,
    transaction: TransactionWithAccount,
    amount: number,
    targetAccountId: string,
  ): Promise<void> {
    const absolute = new Prisma.Decimal(Math.abs(amount).toFixed(2));
    const bankAccountId = transaction.bankAccount.ledgerAccountId;
    const lines =
      amount > 0
        ? [
            { accountId: bankAccountId, debit: absolute },
            { accountId: targetAccountId, credit: absolute },
          ]
        : [
            { accountId: targetAccountId, debit: absolute },
            { accountId: bankAccountId, credit: absolute },
          ];
    await this.ledger.postWithin(tx, organizationId, {
      date: transaction.date.toISOString().slice(0, 10),
      memo: `Bank transaction: ${transaction.description}`,
      sourceType: JournalSourceType.BANK,
      sourceId: transaction.id,
      lines,
    });
  }
}
