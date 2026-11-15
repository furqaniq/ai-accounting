import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Account, BankAccount, BankAccountType, Prisma } from '@prisma/client';
import { AuditService } from '../tenant/audit.service';
import { ScopedDataAccess } from '../tenant/scoped-data-access.service';
import { CreateBankAccountDto } from './bank-account.dto';

const BANK_ACCOUNT_INCLUDE = {
  ledgerAccount: { select: { id: true, code: true, name: true, type: true } },
  _count: { select: { transactions: true } },
} as const;

type BankAccountRow = Prisma.BankAccountGetPayload<{ include: typeof BANK_ACCOUNT_INCLUDE }>;

export interface BankAccountView {
  id: string;
  name: string;
  type: BankAccountType;
  active: boolean;
  ledgerAccountId: string;
  ledgerAccount: { id: string; code: string; name: string; type: string };
  transactionCount: number;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class BankAccountsService {
  constructor(
    private readonly scoped: ScopedDataAccess,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<BankAccountView[]> {
    const rows = await this.scoped.findMany<BankAccountRow>('bankAccount', {
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: BANK_ACCOUNT_INCLUDE,
    });
    return rows.map((row) => this.toView(row));
  }

  async create(input: CreateBankAccountDto): Promise<BankAccountView> {
    const name = input.name.trim();
    if (!name) throw new BadRequestException('Give the bank account a name');
    const ledger = await this.resolveLedgerAccount(input.ledgerAccountId, input.type);
    let created: BankAccount;
    try {
      created = await this.scoped.create<BankAccount>('bankAccount', {
        name,
        type: input.type,
        ledgerAccountId: ledger.id,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('That ledger account is already linked to a bank account');
      }
      throw error;
    }

    const row = await this.scoped.findById<BankAccountRow>('bankAccount', created.id, {
      include: BANK_ACCOUNT_INCLUDE,
    });
    if (!row) throw new NotFoundException('Bank account not found');
    await this.audit.record('bank.account.create', 'BankAccount', created.id, {
      name: created.name,
      type: created.type,
      ledgerAccount: `${ledger.code} ${ledger.name}`,
    });
    return this.toView(row);
  }

  private async resolveLedgerAccount(
    id: string,
    type: BankAccountType,
  ): Promise<Pick<Account, 'id' | 'code' | 'name' | 'type' | 'active'>> {
    const account = await this.scoped.findById<Account>('account', id, {
      select: { id: true, code: true, name: true, type: true, active: true },
    });
    if (!account) throw new NotFoundException('Ledger account not found');
    if (!account.active) throw new BadRequestException('Choose an active ledger account');
    const required = type === BankAccountType.CREDIT_CARD ? 'LIABILITY' : 'ASSET';
    if (account.type !== required) {
      throw new BadRequestException(
        type === BankAccountType.CREDIT_CARD
          ? 'Credit cards must link to a liability account'
          : 'Bank accounts must link to an asset account',
      );
    }
    return account;
  }

  private toView(row: BankAccountRow): BankAccountView {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      active: row.active,
      ledgerAccountId: row.ledgerAccountId,
      ledgerAccount: row.ledgerAccount,
      transactionCount: row._count.transactions,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
