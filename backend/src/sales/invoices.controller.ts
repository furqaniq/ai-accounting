import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { RequirePermission } from '../tenant/require-permission.decorator';
import { CreateInvoiceDto, ListInvoicesDto, UpdateInvoiceDto } from './invoice.dto';
import { InvoiceView, InvoicesService } from './invoices.service';

@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @RequirePermission('invoices:read')
  async list(@Query() query: ListInvoicesDto): Promise<{ invoices: InvoiceView[] }> {
    return { invoices: await this.invoices.list(query) };
  }

  @Get(':id')
  @RequirePermission('invoices:read')
  find(@Param('id') id: string): Promise<InvoiceView> {
    return this.invoices.find(id);
  }

  @Post()
  @RequirePermission('invoices:manage')
  create(@Body() input: CreateInvoiceDto): Promise<InvoiceView> {
    return this.invoices.create(input);
  }

  @Patch(':id')
  @RequirePermission('invoices:manage')
  update(@Param('id') id: string, @Body() input: UpdateInvoiceDto): Promise<InvoiceView> {
    return this.invoices.update(id, input);
  }

  @Post(':id/send')
  @RequirePermission('invoices:manage')
  send(@Param('id') id: string): Promise<InvoiceView> {
    return this.invoices.send(id);
  }
}
