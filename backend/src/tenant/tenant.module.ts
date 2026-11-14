import { Module } from '@nestjs/common';
import { MembershipsController } from './memberships.controller';
import { MembershipsService } from './memberships.service';
import { OrganizationsController } from './organizations.controller';
import { ScopedDataAccess } from './scoped-data-access.service';
import { TenantContextService } from './tenant-context.service';

@Module({
  controllers: [OrganizationsController, MembershipsController],
  providers: [TenantContextService, ScopedDataAccess, MembershipsService],
  exports: [TenantContextService, ScopedDataAccess],
})
export class TenantModule {}
