import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Customer, Prisma } from '@prisma/client';
import { AuditService } from '../tenant/audit.service';
import { ScopedDataAccess } from '../tenant/scoped-data-access.service';
import { CreateCustomerDto, ListCustomersDto, UpdateCustomerDto } from './customer.dto';
import { CustomerBalanceService } from './customer-balance.service';

export interface CustomerView {
  id: string;
  code: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  notes: string | null;
  active: boolean;
  balance: number;
  createdAt: string;
  updatedAt: string;
}

type CustomerRow = Customer;

const TEXT_FIELDS = [
  'contactName',
  'email',
  'phone',
  'addressLine1',
  'addressLine2',
  'city',
  'region',
  'postalCode',
  'country',
  'notes',
] as const;

@Injectable()
export class CustomersService {
  constructor(
    private readonly scoped: ScopedDataAccess,
    private readonly audit: AuditService,
    private readonly balances: CustomerBalanceService,
  ) {}

  async list(filters: ListCustomersDto): Promise<CustomerView[]> {
    const where: Record<string, unknown> = {};
    if (filters.active !== undefined) where.active = filters.active;
    const search = filters.search?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { contactName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const rows = await this.scoped.findMany<CustomerRow>('customer', {
      where,
      orderBy: { name: 'asc' },
    });
    const balances = await this.balances.forCustomers(rows.map((row) => row.id));
    return rows.map((row) => this.toView(row, balances.get(row.id) ?? 0));
  }

  async find(id: string): Promise<CustomerView> {
    const row = await this.scoped.findById<CustomerRow>('customer', id);
    if (!row) {
      throw new NotFoundException('Customer not found');
    }
    return this.toView(row, await this.balances.forCustomer(row.id));
  }

  async create(input: CreateCustomerDto): Promise<CustomerView> {
    const data = {
      name: input.name.trim(),
      ...this.textData(input),
    };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const customer = await this.scoped.create<CustomerRow>('customer', {
          code: await this.nextCode(),
          ...data,
        });
        await this.audit.record('customer.create', 'Customer', customer.id, {
          code: customer.code,
          name: customer.name,
          email: customer.email,
        });
        return this.toView(customer, 0);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          continue;
        }
        throw error;
      }
    }
    throw new ConflictException('Could not allocate a customer number; try again');
  }

  async update(id: string, input: UpdateCustomerDto): Promise<CustomerView> {
    const current = await this.findRow(id);
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name.trim();
    for (const field of TEXT_FIELDS) {
      const value = input[field];
      if (value !== undefined) {
        data[field] = value.trim() === '' ? null : value.trim();
      }
    }
    if (input.active !== undefined) data.active = input.active;

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const [field, next] of Object.entries(data)) {
      if (next !== current[field as keyof CustomerRow]) {
        changes[field] = { from: current[field as keyof CustomerRow], to: next };
      }
    }

    if (Object.keys(changes).length === 0) {
      return this.find(id);
    }

    const updated = await this.scoped.updateById<CustomerRow>('customer', id, data);
    if (!updated) {
      throw new NotFoundException('Customer not found');
    }
    await this.audit.record('customer.update', 'Customer', id, { changes });
    return this.toView(updated, await this.balances.forCustomer(id));
  }

  private async findRow(id: string): Promise<CustomerRow> {
    const row = await this.scoped.findById<CustomerRow>('customer', id);
    if (!row) {
      throw new NotFoundException('Customer not found');
    }
    return row;
  }

  private textData(input: CreateCustomerDto): Record<string, string | null> {
    const data: Record<string, string | null> = {};
    for (const field of TEXT_FIELDS) {
      const value = input[field]?.trim();
      data[field] = value ? value : null;
    }
    return data;
  }

  private async nextCode(): Promise<string> {
    const rows = await this.scoped.findMany<{ code: string }>('customer', {
      where: { code: { startsWith: 'CUST-' } },
      orderBy: { code: 'desc' },
      take: 1,
    });
    const last = Number.parseInt(rows[0]?.code.slice('CUST-'.length) ?? '0', 10);
    const next = Number.isFinite(last) ? last + 1 : 1;
    return `CUST-${String(next).padStart(4, '0')}`;
  }

  private toView(row: CustomerRow, balance: number): CustomerView {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      contactName: row.contactName,
      email: row.email,
      phone: row.phone,
      addressLine1: row.addressLine1,
      addressLine2: row.addressLine2,
      city: row.city,
      region: row.region,
      postalCode: row.postalCode,
      country: row.country,
      notes: row.notes,
      active: row.active,
      balance,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
