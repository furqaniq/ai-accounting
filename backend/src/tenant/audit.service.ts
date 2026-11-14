import { Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { ScopedDataAccess } from './scoped-data-access.service';
import { TenantRequest } from './tenant-context.service';

@Injectable({ scope: Scope.REQUEST })
export class AuditService {
  constructor(
    private readonly scoped: ScopedDataAccess,
    @Inject(REQUEST) private readonly request: TenantRequest,
  ) {}

  async record(
    action: string,
    entityType: string,
    entityId: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const actorUserId = this.request.user?.userId;
    if (!actorUserId) return;
    await this.scoped.create('auditLogEntry', {
      actorUserId,
      action,
      entityType,
      entityId,
      metadata: metadata ?? undefined,
    });
  }
}
