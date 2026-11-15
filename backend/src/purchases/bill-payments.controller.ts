import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { RequirePermission } from '../tenant/require-permission.decorator';
import { CreateBillPaymentDto, ListBillPaymentsDto } from './bill-payment.dto';
import { BillPaymentsService, BillPaymentView } from './bill-payments.service';

@Controller('bill-payments')
export class BillPaymentsController {
  constructor(private readonly billPayments: BillPaymentsService) {}

  @Get()
  @RequirePermission('bills:read')
  async list(
    @Query() query: ListBillPaymentsDto,
  ): Promise<{ billPayments: BillPaymentView[] }> {
    return { billPayments: await this.billPayments.list(query) };
  }

  @Get(':id')
  @RequirePermission('bills:read')
  find(@Param('id') id: string): Promise<BillPaymentView> {
    return this.billPayments.find(id);
  }

  @Post()
  @RequirePermission('bills:manage')
  create(@Body() input: CreateBillPaymentDto): Promise<BillPaymentView> {
    return this.billPayments.create(input);
  }
}
