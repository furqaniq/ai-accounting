import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermission } from '../tenant/require-permission.decorator';
import { ApAgingQueryDto } from './ap-aging.dto';
import { ApAgingService, ApAgingView } from './ap-aging.service';

@Controller('reports/ap-aging')
export class ApAgingController {
  constructor(private readonly apAging: ApAgingService) {}

  @Get()
  @RequirePermission('reports:read')
  report(@Query() query: ApAgingQueryDto): Promise<ApAgingView> {
    return this.apAging.report(query.asOf);
  }
}
