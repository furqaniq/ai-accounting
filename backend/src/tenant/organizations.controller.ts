import { Controller, Get } from '@nestjs/common';
import { RequirePermission } from './require-permission.decorator';
import { ActiveMembership, TenantContextService } from './tenant-context.service';

@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly tenant: TenantContextService) {}

  @Get('active')
  @RequirePermission('org:read')
  active(): Promise<ActiveMembership> {
    return this.tenant.get();
  }
}
