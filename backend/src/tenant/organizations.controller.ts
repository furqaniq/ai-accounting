import { Body, Controller, Get, Patch } from '@nestjs/common';
import { OrganizationsService, SettingsView } from './organizations.service';
import { RequirePermission } from './require-permission.decorator';
import { UpdateOrganizationSettingsDto } from './settings.dto';
import { ActiveMembership, TenantContextService } from './tenant-context.service';

@Controller('organizations')
export class OrganizationsController {
  constructor(
    private readonly tenant: TenantContextService,
    private readonly organizations: OrganizationsService,
  ) {}

  @Get('active')
  @RequirePermission('org:read')
  active(): Promise<ActiveMembership> {
    return this.tenant.get();
  }

  @Get('settings')
  @RequirePermission('org:read')
  settings(): Promise<SettingsView> {
    return this.organizations.getSettings();
  }

  @Patch('settings')
  @RequirePermission('org:manage')
  updateSettings(@Body() input: UpdateOrganizationSettingsDto): Promise<SettingsView> {
    return this.organizations.updateSettings(input);
  }
}
