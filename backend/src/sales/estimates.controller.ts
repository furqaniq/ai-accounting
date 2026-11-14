import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { RequirePermission } from '../tenant/require-permission.decorator';
import {
  CreateEstimateDto,
  ListEstimatesDto,
  UpdateEstimateDto,
  UpdateEstimateStatusDto,
} from './estimate.dto';
import { EstimateView, EstimatesService } from './estimates.service';

@Controller('estimates')
export class EstimatesController {
  constructor(private readonly estimates: EstimatesService) {}

  @Get()
  @RequirePermission('estimates:read')
  async list(@Query() query: ListEstimatesDto): Promise<{ estimates: EstimateView[] }> {
    return { estimates: await this.estimates.list(query) };
  }

  @Get(':id')
  @RequirePermission('estimates:read')
  find(@Param('id') id: string): Promise<EstimateView> {
    return this.estimates.find(id);
  }

  @Post()
  @RequirePermission('estimates:manage')
  create(@Body() input: CreateEstimateDto): Promise<EstimateView> {
    return this.estimates.create(input);
  }

  @Patch(':id')
  @RequirePermission('estimates:manage')
  update(
    @Param('id') id: string,
    @Body() input: UpdateEstimateDto,
  ): Promise<EstimateView> {
    return this.estimates.update(id, input);
  }

  @Post(':id/convert')
  @RequirePermission('estimates:manage')
  convert(@Param('id') id: string): Promise<EstimateView> {
    return this.estimates.convert(id);
  }

  @Post(':id/status')
  @RequirePermission('estimates:manage')
  changeStatus(
    @Param('id') id: string,
    @Body() input: UpdateEstimateStatusDto,
  ): Promise<EstimateView> {
    return this.estimates.changeStatus(id, input);
  }
}
