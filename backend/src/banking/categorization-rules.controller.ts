import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { RequirePermission } from '../tenant/require-permission.decorator';
import {
  CreateCategorizationRuleDto,
  UpdateCategorizationRuleDto,
} from './categorization-rule.dto';
import {
  CategorizationRuleView,
  CategorizationRulesService,
} from './categorization-rules.service';

@Controller('categorization-rules')
export class CategorizationRulesController {
  constructor(private readonly rules: CategorizationRulesService) {}

  @Get()
  @RequirePermission('banking:read')
  async list(): Promise<{ rules: CategorizationRuleView[] }> {
    return { rules: await this.rules.list() };
  }

  @Post()
  @RequirePermission('banking:manage')
  create(@Body() input: CreateCategorizationRuleDto): Promise<CategorizationRuleView> {
    return this.rules.create(input);
  }

  @Patch(':id')
  @RequirePermission('banking:manage')
  update(
    @Param('id') id: string,
    @Body() input: UpdateCategorizationRuleDto,
  ): Promise<CategorizationRuleView> {
    return this.rules.update(id, input);
  }

  @Delete(':id')
  @RequirePermission('banking:manage')
  async remove(@Param('id') id: string): Promise<void> {
    await this.rules.remove(id);
  }
}
