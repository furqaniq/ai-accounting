import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { RequirePermission } from '../tenant/require-permission.decorator';
import { CreatePaymentDto, ListPaymentsDto } from './payment.dto';
import { PaymentView, PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  @RequirePermission('payments:read')
  async list(@Query() query: ListPaymentsDto): Promise<{ payments: PaymentView[] }> {
    return { payments: await this.payments.list(query) };
  }

  @Get(':id')
  @RequirePermission('payments:read')
  find(@Param('id') id: string): Promise<PaymentView> {
    return this.payments.find(id);
  }

  @Post()
  @RequirePermission('payments:manage')
  create(@Body() input: CreatePaymentDto): Promise<PaymentView> {
    return this.payments.create(input);
  }
}
