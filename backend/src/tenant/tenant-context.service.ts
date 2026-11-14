import { BadRequestException, ForbiddenException, Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
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

export const ORGANIZATION_HEADER = 'x-organization-id';

@Injectable({ scope: Scope.REQUEST })
export class TenantContextService {
  private resolved?: ActiveMembership;

  constructor(
    @Inject(REQUEST) private readonly request: TenantRequest,
    private readonly prisma: PrismaService,
  ) {}

  async get(): Promise<ActiveMembership> {
    if (this.resolved) {
      return this.resolved;
    }
    if (this.request.tenantMembership) {
      this.resolved = this.request.tenantMembership;
      return this.resolved;
    }

    const organizationId = this.organizationId();
    const membership = await resolveMembership(
      this.prisma,
      this.request.user?.userId,
      organizationId,
    );
    if (!membership) {
      throw new ForbiddenException('Organization not accessible');
    }

    this.resolved = membership;
    this.request.tenantMembership = membership;
    return this.resolved;
  }

  organizationIdHeader(): string {
    return this.organizationId();
  }

  private organizationId(): string {
    const header = this.request.headers[ORGANIZATION_HEADER];
    const value = Array.isArray(header) ? header[0] : header;
    if (!value) {
      throw new BadRequestException('Active organization is required');
    }
    return value;
  }
}
