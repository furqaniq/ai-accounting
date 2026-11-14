import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';
import { UpdateOrganizationSettingsDto } from './settings.dto';
import { TenantContextService } from './tenant-context.service';

export interface SettingsView {
  organizationId: string;
  name: string;
  fiscalYearStartMonth: number;
  fiscalYearStartDay: number;
  baseCurrency: string;
  defaultTaxRate: number;
  updatedAt: Date;
}

export const SETTINGS_FIELDS = [
  'name',
  'fiscalYearStartMonth',
  'fiscalYearStartDay',
  'baseCurrency',
  'defaultTaxRate',
] as const;

type SettingsField = (typeof SETTINGS_FIELDS)[number];

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly tenant: TenantContextService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getSettings(): Promise<SettingsView> {
    const { organizationId } = await this.tenant.get();
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });
    return toView(organization);
  }

  async updateSettings(input: UpdateOrganizationSettingsDto): Promise<SettingsView> {
    const { organizationId } = await this.tenant.get();
    const current = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });

    const changes: Partial<Record<SettingsField, { from: unknown; to: unknown }>> = {};
    for (const field of SETTINGS_FIELDS) {
      const next = input[field];
      if (next === undefined) continue;
      const before = field === 'defaultTaxRate' ? Number(current[field]) : current[field];
      if (next !== before) {
        changes[field] = { from: before, to: next };
      }
    }

    if (Object.keys(changes).length === 0) {
      return toView(current);
    }

    const updated = await this.prisma.organization.update({
      where: { id: organizationId },
      data: input,
    });
    await this.audit.record('org.settings.update', 'Organization', organizationId, { changes });
    return toView(updated);
  }
}

function toView(organization: {
  id: string;
  name: string;
  fiscalYearStartMonth: number;
  fiscalYearStartDay: number;
  baseCurrency: string;
  defaultTaxRate: unknown;
  updatedAt: Date;
}): SettingsView {
  return {
    organizationId: organization.id,
    name: organization.name,
    fiscalYearStartMonth: organization.fiscalYearStartMonth,
    fiscalYearStartDay: organization.fiscalYearStartDay,
    baseCurrency: organization.baseCurrency,
    defaultTaxRate: Number(organization.defaultTaxRate),
    updatedAt: organization.updatedAt,
  };
}
