import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermission } from '../tenant/require-permission.decorator';
import { RegisterQueryDto } from './ledger.dto';
import { LedgerService } from './ledger.service';

@Controller('ledger')
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Get('register')
  @RequirePermission('ledger:read')
  register(@Query() query: RegisterQueryDto) {
    return this.ledger.register(query);
  }
}
