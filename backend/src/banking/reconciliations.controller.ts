import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { RequirePermission } from '../tenant/require-permission.decorator';
import {
  CreateReconciliationDto,
  ListReconciliationsDto,
  SetReconciliationClearedDto,
} from './reconciliation.dto';
import {
  ReconciliationDetailView,
  ReconciliationSessionView,
  ReconciliationsService,
} from './reconciliations.service';

@Controller('reconciliations')
export class ReconciliationsController {
  constructor(private readonly reconciliations: ReconciliationsService) {}

  @Get()
  @RequirePermission('banking:read')
  async list(
    @Query() query: ListReconciliationsDto,
  ): Promise<{ sessions: ReconciliationSessionView[] }> {
    return { sessions: await this.reconciliations.list(query) };
  }

  @Get(':id')
  @RequirePermission('banking:read')
  find(@Param('id') id: string): Promise<ReconciliationDetailView> {
    return this.reconciliations.find(id);
  }

  @Post()
  @RequirePermission('banking:manage')
  start(@Body() input: CreateReconciliationDto): Promise<ReconciliationDetailView> {
    return this.reconciliations.start(input);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('banking:manage')
  complete(@Param('id') id: string): Promise<ReconciliationDetailView> {
    return this.reconciliations.complete(id);
  }

  @Post(':id/undo')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('banking:manage')
  undo(@Param('id') id: string): Promise<ReconciliationDetailView> {
    return this.reconciliations.undo(id);
  }

  @Patch(':id/transactions/:transactionId')
  @RequirePermission('banking:manage')
  setCleared(
    @Param('id') id: string,
    @Param('transactionId') transactionId: string,
    @Body() input: SetReconciliationClearedDto,
  ): Promise<ReconciliationDetailView> {
    return this.reconciliations.setCleared(id, transactionId, input.cleared);
  }
}
