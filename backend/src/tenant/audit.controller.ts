import { Controller, Get, Query } from '@nestjs/common';
import { AuditQueryDto } from './audit-query.dto';
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
  async list(@Query() query: AuditQueryDto) {
    const where: Record<string, unknown> = {};
    if (query.action) where.action = query.action;
    if (query.entityType) where.entityType = query.entityType;

    const rows = await this.scoped.findMany<AuditRow>('auditLogEntry', {
      where,
      include: { actor: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? 50,
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
