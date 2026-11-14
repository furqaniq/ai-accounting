import { BadRequestException, ForbiddenException, Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';

export interface ActiveMembership {
  organizationId: string;
  organizationName: string;
  role: string;
}

export interface TenantRequest {
  user?: { userId: string; email: string };
  headers: Record<string, string | string[] | undefined>;
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

    const organizationId = this.organizationId();
    const membership = await this.prisma.orgMembership.findFirst({
      where: { organizationId, userId: this.request.user?.userId },
      include: { organization: true },
    });

    if (!membership) {
      throw new ForbiddenException('Organization not accessible');
    }

    this.resolved = {
      organizationId: membership.organizationId,
      organizationName: membership.organization.name,
      role: membership.role,
    };
    return this.resolved;
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
