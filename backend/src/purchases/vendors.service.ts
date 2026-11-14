import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Vendor } from '@prisma/client';
import { AuditService } from '../tenant/audit.service';
import { ScopedDataAccess } from '../tenant/scoped-data-access.service';
import { CreateVendorDto, ListVendorsDto, UpdateVendorDto } from './vendor.dto';
import { VendorBalanceService } from './vendor-balance.service';

export interface VendorView {
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

type VendorRow = Vendor;

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
export class VendorsService {
  constructor(
    private readonly scoped: ScopedDataAccess,
    private readonly audit: AuditService,
    private readonly balances: VendorBalanceService,
  ) {}

  async list(filters: ListVendorsDto): Promise<VendorView[]> {
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

    const rows = await this.scoped.findMany<VendorRow>('vendor', {
      where,
      orderBy: { name: 'asc' },
    });
    const balances = await this.balances.forVendors(rows.map((row) => row.id));
    return rows.map((row) => this.toView(row, balances.get(row.id) ?? 0));
  }

  async find(id: string): Promise<VendorView> {
    const row = await this.findRow(id);
    return this.toView(row, await this.balances.forVendor(row.id));
  }

  async create(input: CreateVendorDto): Promise<VendorView> {
    const data = {
      name: input.name.trim(),
      ...this.textData(input),
    };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const vendor = await this.scoped.create<VendorRow>('vendor', {
          code: await this.nextCode(),
          ...data,
        });
        await this.audit.record('vendor.create', 'Vendor', vendor.id, {
          code: vendor.code,
          name: vendor.name,
          email: vendor.email,
        });
        return this.toView(vendor, 0);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          continue;
        }
        throw error;
      }
    }
    throw new ConflictException('Could not allocate a vendor number; try again');
  }

  async update(id: string, input: UpdateVendorDto): Promise<VendorView> {
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
      if (next !== current[field as keyof VendorRow]) {
        changes[field] = { from: current[field as keyof VendorRow], to: next };
      }
    }

    if (Object.keys(changes).length === 0) {
      return this.find(id);
    }

    const updated = await this.scoped.updateById<VendorRow>('vendor', id, data);
    if (!updated) {
      throw new NotFoundException('Vendor not found');
    }
    await this.audit.record('vendor.update', 'Vendor', id, { changes });
    return this.toView(updated, await this.balances.forVendor(id));
  }

  private async findRow(id: string): Promise<VendorRow> {
    const row = await this.scoped.findById<VendorRow>('vendor', id);
    if (!row) {
      throw new NotFoundException('Vendor not found');
    }
    return row;
  }

  private textData(input: CreateVendorDto): Record<string, string | null> {
    const data: Record<string, string | null> = {};
    for (const field of TEXT_FIELDS) {
      const value = input[field]?.trim();
      data[field] = value ? value : null;
    }
    return data;
  }

  private async nextCode(): Promise<string> {
    const rows = await this.scoped.findMany<{ code: string }>('vendor', {
      where: { code: { startsWith: 'VEND-' } },
      orderBy: { code: 'desc' },
      take: 1,
    });
    const last = Number.parseInt(rows[0]?.code.slice('VEND-'.length) ?? '0', 10);
    const next = Number.isFinite(last) ? last + 1 : 1;
    return `VEND-${String(next).padStart(4, '0')}`;
  }

  private toView(row: VendorRow, balance: number): VendorView {
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
