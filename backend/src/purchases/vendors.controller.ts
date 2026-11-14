import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { RequirePermission } from '../tenant/require-permission.decorator';
import { CreateVendorDto, ListVendorsDto, UpdateVendorDto } from './vendor.dto';
import { VendorView, VendorsService } from './vendors.service';

@Controller('vendors')
export class VendorsController {
  constructor(private readonly vendors: VendorsService) {}

  @Get()
  @RequirePermission('vendors:read')
  async list(@Query() query: ListVendorsDto): Promise<{ vendors: VendorView[] }> {
    return { vendors: await this.vendors.list(query) };
  }

  @Get(':id')
  @RequirePermission('vendors:read')
  find(@Param('id') id: string): Promise<VendorView> {
    return this.vendors.find(id);
  }

  @Post()
  @RequirePermission('vendors:manage')
  create(@Body() input: CreateVendorDto): Promise<VendorView> {
    return this.vendors.create(input);
  }

  @Patch(':id')
  @RequirePermission('vendors:manage')
  update(@Param('id') id: string, @Body() input: UpdateVendorDto): Promise<VendorView> {
    return this.vendors.update(id, input);
  }
}
