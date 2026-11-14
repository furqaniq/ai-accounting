import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Account } from '@prisma/client';
import { AuditService } from '../tenant/audit.service';
import { ScopedDataAccess } from '../tenant/scoped-data-access.service';
import { CreateAccountDto, UpdateAccountDto } from './account.dto';

type AccountRow = Account;

@Injectable()
export class AccountsService {
  constructor(
    private readonly scoped: ScopedDataAccess,
    private readonly audit: AuditService,
  ) {}

  async list(filters: { type?: string; active?: boolean }): Promise<AccountRow[]> {
    const where: Record<string, unknown> = {};
    if (filters.type) where.type = filters.type;
    if (filters.active !== undefined) where.active = filters.active;

    return this.scoped.findMany<AccountRow>('account', {
      where,
      orderBy: { code: 'asc' },
    });
  }

  async create(input: CreateAccountDto): Promise<AccountRow> {
    await this.assertCodeAvailable(input.code);

    const account = await this.scoped.create<AccountRow>('account', {
      code: input.code,
      name: input.name,
      type: input.type,
      subtype: input.subtype ?? null,
    });
    await this.audit.record('account.create', 'Account', account.id, {
      code: account.code,
      name: account.name,
      type: account.type,
      subtype: account.subtype,
    });
    return account;
  }

  async update(id: string, input: UpdateAccountDto): Promise<AccountRow> {
    const current = await this.find(id);
    if (input.code && input.code !== current.code) {
      await this.assertCodeAvailable(input.code, id);
    }

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const field of ['code', 'name', 'type', 'subtype', 'active'] as const) {
      const next = input[field];
      if (next === undefined) continue;
      if (next !== current[field]) {
        changes[field] = { from: current[field], to: next };
      }
    }

    if (Object.keys(changes).length === 0) {
      return current;
    }

    const updated = await this.scoped.updateById<AccountRow>('account', id, {
      ...input,
    });
    if (!updated) {
      throw new NotFoundException('Account not found');
    }
    await this.audit.record('account.update', 'Account', id, { changes });
    return updated;
  }

  private async find(id: string): Promise<AccountRow> {
    const account = await this.scoped.findById<AccountRow>('account', id);
    if (!account) {
      throw new NotFoundException('Account not found');
    }
    return account;
  }

  private async assertCodeAvailable(code: string, exceptId?: string): Promise<void> {
    const matches = await this.scoped.findMany<{ id: string }>('account', {
      where: { code },
      select: { id: true },
    });
    if (matches.some((match) => match.id !== exceptId)) {
      throw new ConflictException('An account with that code already exists');
    }
  }
}
