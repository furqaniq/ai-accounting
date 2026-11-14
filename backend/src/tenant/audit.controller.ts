import { Controller, Get } from '@nestjs/common';
import { ScopedDataAccess } from './scoped-data-access.service';
import { RequirePermission } from './require-permission.decorator';

interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  actor: { id: string; name: string; email: string };
}

@Controller('audit-log')
export class AuditController {
  constructor(private readonly scoped: ScopedDataAccess) {}

  @Get()
  @RequirePermission('audit:read')
  async list() {
    const rows = await this.scoped.findMany<AuditRow>('auditLogEntry', {
      include: { actor: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return {
      entries: rows.map((row) => ({
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        metadata: row.metadata,
        createdAt: row.createdAt,
        actor: row.actor,
      })),
    };
  }
}
