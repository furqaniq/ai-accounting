import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { MembershipsController } from './memberships.controller';
import { MembershipsService } from './memberships.service';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { ScopedDataAccess } from './scoped-data-access.service';
import { TenantContextService } from './tenant-context.service';

@Module({
  controllers: [OrganizationsController, MembershipsController, AuditController],
  providers: [
    TenantContextService,
    ScopedDataAccess,
    MembershipsService,
    OrganizationsService,
    AuditService,
  ],
  exports: [TenantContextService, ScopedDataAccess, AuditService],
})
export class TenantModule {}
