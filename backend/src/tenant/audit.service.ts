import { Injectable } from '@nestjs/common';
import { ScopedDataAccess } from './scoped-data-access.service';
import { TenantContextService } from './tenant-context.service';

@Injectable()
export class AuditService {
  constructor(
    private readonly scoped: ScopedDataAccess,
    private readonly tenant: TenantContextService,
  ) {}

  async record(
    action: string,
    entityType: string,
    entityId: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const actorUserId = this.tenant.userId();
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
