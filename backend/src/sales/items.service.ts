import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AccountType, Item, Prisma } from '@prisma/client';
import { AuditService } from '../tenant/audit.service';
import { ScopedDataAccess } from '../tenant/scoped-data-access.service';
import { CreateItemDto, ListItemsDto, UpdateItemDto } from './item.dto';

type ItemRow = Item;
type ItemRowWithAccount = Prisma.ItemGetPayload<{
  include: { incomeAccount: { select: { id: true; code: true; name: true } } };
}>;

export interface ItemView {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price: number;
  incomeAccountId: string;
  incomeAccount: { id: string; code: string; name: string };
  taxable: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class ItemsService {
  constructor(
    private readonly scoped: ScopedDataAccess,
    private readonly audit: AuditService,
  ) {}

  async list(filters: ListItemsDto): Promise<ItemView[]> {
    const where: Record<string, unknown> = {};
    if (filters.active !== undefined) where.active = filters.active;
    const search = filters.search?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const rows = await this.scoped.findMany<ItemRowWithAccount>('item', {
      where,
      orderBy: { name: 'asc' },
      include: { incomeAccount: { select: { id: true, code: true, name: true } } },
    });
    return rows.map((row) => this.toView(row));
  }

  async find(id: string): Promise<ItemView> {
    return this.toView(await this.findRow(id));
  }

  async create(input: CreateItemDto): Promise<ItemView> {
    await this.assertIncomeAccount(input.incomeAccountId);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const item = await this.scoped.create<ItemRow>('item', {
          code: await this.nextCode(),
          name: input.name.trim(),
          description: input.description?.trim() || null,
          price: new Prisma.Decimal(input.price),
          incomeAccountId: input.incomeAccountId,
          taxable: input.taxable ?? true,
        });
        await this.audit.record('item.create', 'Item', item.id, {
          code: item.code,
          name: item.name,
          price: item.price.toString(),
          incomeAccountId: item.incomeAccountId,
          taxable: item.taxable,
        });
        return this.find(item.id);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          continue;
        }
        throw error;
      }
    }
    throw new ConflictException('Could not allocate an item code; try again');
  }

  async update(id: string, input: UpdateItemDto): Promise<ItemView> {
    const current = await this.findRow(id);
    if (input.incomeAccountId && input.incomeAccountId !== current.incomeAccountId) {
      await this.assertIncomeAccount(input.incomeAccountId);
    }

    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.description !== undefined) {
      data.description = input.description.trim() === '' ? null : input.description.trim();
    }
    if (input.price !== undefined) data.price = new Prisma.Decimal(input.price);
    if (input.incomeAccountId !== undefined) data.incomeAccountId = input.incomeAccountId;
    if (input.taxable !== undefined) data.taxable = input.taxable;
    if (input.active !== undefined) data.active = input.active;

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const [field, next] of Object.entries(data)) {
      const previous = current[field as keyof ItemRow];
      const from = previous instanceof Prisma.Decimal ? previous.toString() : previous;
      const to = next instanceof Prisma.Decimal ? next.toString() : next;
      if (from !== to) changes[field] = { from, to };
    }

    if (Object.keys(changes).length === 0) {
      return this.find(id);
    }

    const updated = await this.scoped.updateById<ItemRow>('item', id, data);
    if (!updated) {
      throw new NotFoundException('Item not found');
    }
    await this.audit.record('item.update', 'Item', id, { changes });
    return this.find(id);
  }

  private async findRow(id: string): Promise<ItemRowWithAccount> {
    const row = await this.scoped.findById<ItemRowWithAccount>('item', id, {
      include: { incomeAccount: { select: { id: true, code: true, name: true } } },
    });
    if (!row) {
      throw new NotFoundException('Item not found');
    }
    return row;
  }

  private async assertIncomeAccount(accountId: string): Promise<void> {
    const account = await this.scoped.findById<{ id: string; type: AccountType; active: boolean }>(
      'account',
      accountId,
      { select: { id: true, type: true, active: true } },
    );
    if (!account) {
      throw new BadRequestException('Income account must belong to this organization');
    }
    if (account.type !== AccountType.INCOME) {
      throw new BadRequestException('Income account must be an income account');
    }
    if (!account.active) {
      throw new BadRequestException('Income account is deactivated');
    }
  }

  private async nextCode(): Promise<string> {
    const rows = await this.scoped.findMany<{ code: string }>('item', {
      where: { code: { startsWith: 'ITEM-' } },
      orderBy: { code: 'desc' },
      take: 1,
    });
    const last = Number.parseInt(rows[0]?.code.slice('ITEM-'.length) ?? '0', 10);
    const next = Number.isFinite(last) ? last + 1 : 1;
    return `ITEM-${String(next).padStart(4, '0')}`;
  }

  private toView(row: ItemRowWithAccount): ItemView {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      price: Number(row.price.toString()),
      incomeAccountId: row.incomeAccountId,
      incomeAccount: row.incomeAccount,
      taxable: row.taxable,
      active: row.active,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
