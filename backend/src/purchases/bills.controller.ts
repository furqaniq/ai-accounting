import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { RequirePermission } from '../tenant/require-permission.decorator';
import { CreateBillDto, ListBillsDto, UpdateBillDto } from './bill.dto';
import { BillView, BillsService } from './bills.service';

@Controller('bills')
export class BillsController {
  constructor(private readonly bills: BillsService) {}

  @Get()
  @RequirePermission('bills:read')
  async list(@Query() query: ListBillsDto): Promise<{ bills: BillView[] }> {
    return { bills: await this.bills.list(query) };
  }

  @Get(':id')
  @RequirePermission('bills:read')
  find(@Param('id') id: string): Promise<BillView> {
    return this.bills.find(id);
  }

  @Post()
  @RequirePermission('bills:manage')
  create(@Body() input: CreateBillDto): Promise<BillView> {
    return this.bills.create(input);
  }

  @Patch(':id')
  @RequirePermission('bills:manage')
  update(@Param('id') id: string, @Body() input: UpdateBillDto): Promise<BillView> {
    return this.bills.update(id, input);
  }

  @Post(':id/open')
  @RequirePermission('bills:manage')
  open(@Param('id') id: string): Promise<BillView> {
    return this.bills.open(id);
  }
}
