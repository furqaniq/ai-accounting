import { Injectable, Scope } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from './tenant-context.service';

type ScopedModel = 'orgMembership';

interface FindArgs {
  where?: Record<string, unknown>;
  orderBy?: Record<string, unknown> | Array<Record<string, unknown>>;
  select?: Record<string, unknown>;
  include?: Record<string, unknown>;
  take?: number;
  skip?: number;
}

/**
 * The single place where organization scoping is applied. Feature services ask
 * for rows; they never write `organizationId` filters themselves, so a caller
 * cannot read or mutate another tenant's rows — even with a known id.
 */
@Injectable({ scope: Scope.REQUEST })
export class ScopedDataAccess {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  async findMany<T>(model: ScopedModel, args: FindArgs = {}): Promise<T[]> {
    const { organizationId } = await this.tenant.get();
    const delegate = this.delegate(model);
    return delegate.findMany({
      ...args,
      where: { ...args.where, organizationId },
    }) as Promise<T[]>;
  }

  async findById<T>(model: ScopedModel, id: string, args: FindArgs = {}): Promise<T | null> {
    const { organizationId } = await this.tenant.get();
    const delegate = this.delegate(model);
    return delegate.findFirst({
      ...args,
      where: { ...args.where, id, organizationId },
    }) as Promise<T | null>;
  }

  private delegate(model: ScopedModel) {
    return (this.prisma as unknown as Record<ScopedModel, {
      findMany: (args: unknown) => unknown;
      findFirst: (args: unknown) => unknown;
    }>)[model];
  }
}
