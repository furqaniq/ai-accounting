import { Controller, Get } from '@nestjs/common';
import { ActiveMembership, TenantContextService } from './tenant-context.service';

@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly tenant: TenantContextService) {}

  @Get('active')
  active(): Promise<ActiveMembership> {
    return this.tenant.get();
  }
}
