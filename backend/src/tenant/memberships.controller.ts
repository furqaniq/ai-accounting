import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { CreateMembershipDto, UpdateMembershipRoleDto } from './membership.dto';
import { RequirePermission } from './require-permission.decorator';
import { MemberView, MembershipsService } from './memberships.service';

@Controller('memberships')
export class MembershipsController {
  constructor(private readonly memberships: MembershipsService) {}

  @Get()
  @RequirePermission('members:read')
  async list(): Promise<{ memberships: MemberView[] }> {
    return { memberships: await this.memberships.list() };
  }

  @Post()
  @RequirePermission('members:manage')
  create(@Body() dto: CreateMembershipDto): Promise<MemberView> {
    return this.memberships.create(dto.email, dto.role);
  }

  @Get(':id')
  @RequirePermission('members:read')
  get(@Param('id') id: string): Promise<MemberView> {
    return this.memberships.get(id);
  }

  @Patch(':id')
  @RequirePermission('members:manage')
  update(@Param('id') id: string, @Body() dto: UpdateMembershipRoleDto): Promise<MemberView> {
    return this.memberships.updateRole(id, dto.role);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('members:manage')
  async remove(@Param('id') id: string): Promise<void> {
    await this.memberships.remove(id);
  }
}
