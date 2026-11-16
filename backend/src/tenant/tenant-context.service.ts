import { AsyncLocalStorage } from 'node:async_hooks';
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolveMembership } from './membership-resolution';

export interface ActiveMembership {
  organizationId: string;
  organizationName: string;
  role: string;
}

export interface TenantRequest {
  user?: { userId: string; email: string };
  headers: Record<string, string | string[] | undefined>;
  tenantMembership?: ActiveMembership;
}

export interface TenantActor {
  user?: { userId: string; email: string };
  membership?: ActiveMembership;
}

interface TenantStore {
  actor: TenantActor;
  request?: TenantRequest;
}

export const ORGANIZATION_HEADER = 'x-organization-id';

/**
 * Resolves the active organization/membership for HTTP requests and background
 * jobs. The context is carried in AsyncLocalStorage so the same singleton can
 * serve a request (middleware + guards) and a BullMQ worker (`runAs`).
 */
@Injectable()
export class TenantContextService {
  private readonly storage = new AsyncLocalStorage<TenantStore>();

  constructor(private readonly prisma: PrismaService) {}

  runWithRequest<T>(request: TenantRequest, fn: () => T): T {
    return this.storage.run({ actor: {}, request }, fn);
  }

  runAs<T>(actor: TenantActor, fn: () => T): T {
    return this.storage.run({ actor }, fn);
  }

  async get(): Promise<ActiveMembership> {
    const store = this.store();
    if (store?.actor.membership) {
      return store.actor.membership;
    }
    if (store?.request?.tenantMembership) {
      store.actor.membership = store.request.tenantMembership;
      store.actor.user = store.request.user;
      return store.actor.membership;
    }

    const membership = await resolveMembership(
      this.prisma,
      this.userId(),
      this.organizationIdHeader(),
    );
    if (!membership) {
      throw new ForbiddenException('Organization not accessible');
    }

    if (store) {
      store.actor.membership = membership;
      if (store.request?.user) store.actor.user = store.request.user;
      if (store.request) store.request.tenantMembership = membership;
    }
    return membership;
  }

  organizationIdHeader(): string {
    const store = this.store();
    const membership = store?.actor.membership ?? store?.request?.tenantMembership;
    if (membership) {
      return membership.organizationId;
    }
    const header = store?.request?.headers?.[ORGANIZATION_HEADER];
    const value = Array.isArray(header) ? header[0] : header;
    if (!value) {
      throw new BadRequestException('Active organization is required');
    }
    return value;
  }

  userId(): string | undefined {
    const store = this.store();
    return store?.actor.user?.userId ?? store?.request?.user?.userId;
  }

  private store(): TenantStore | undefined {
    return this.storage.getStore();
  }
}
