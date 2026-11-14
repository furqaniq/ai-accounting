import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { RequirePermission } from '../tenant/require-permission.decorator';
import { CreateCustomerDto, ListCustomersDto, UpdateCustomerDto } from './customer.dto';
import { CustomerView, CustomersService } from './customers.service';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermission('customers:read')
  async list(@Query() query: ListCustomersDto): Promise<{ customers: CustomerView[] }> {
    return { customers: await this.customers.list(query) };
  }

  @Get(':id')
  @RequirePermission('customers:read')
  find(@Param('id') id: string): Promise<CustomerView> {
    return this.customers.find(id);
  }

  @Post()
  @RequirePermission('customers:manage')
  create(@Body() input: CreateCustomerDto): Promise<CustomerView> {
    return this.customers.create(input);
  }

  @Patch(':id')
  @RequirePermission('customers:manage')
  update(@Param('id') id: string, @Body() input: UpdateCustomerDto): Promise<CustomerView> {
    return this.customers.update(id, input);
  }
}
