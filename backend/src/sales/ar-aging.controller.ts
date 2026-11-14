import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermission } from '../tenant/require-permission.decorator';
import { ArAgingQueryDto } from './ar-aging.dto';
import { ArAgingService, ArAgingView } from './ar-aging.service';

@Controller('reports/ar-aging')
export class ArAgingController {
  constructor(private readonly arAging: ArAgingService) {}

  @Get()
  @RequirePermission('reports:read')
  report(@Query() query: ArAgingQueryDto): Promise<ArAgingView> {
    return this.arAging.report(query.asOf);
  }
}
