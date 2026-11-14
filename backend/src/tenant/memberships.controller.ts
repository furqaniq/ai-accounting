import { Controller, Get, Param } from '@nestjs/common';
import { MemberView, MembershipsService } from './memberships.service';

@Controller('memberships')
export class MembershipsController {
  constructor(private readonly memberships: MembershipsService) {}

  @Get()
  async list(): Promise<{ memberships: MemberView[] }> {
    return { memberships: await this.memberships.list() };
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<MemberView> {
    return this.memberships.get(id);
  }
}
