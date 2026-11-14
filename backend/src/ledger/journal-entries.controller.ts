import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { RequirePermission } from '../tenant/require-permission.decorator';
import {
  CreateJournalEntryDto,
  ListJournalEntriesDto,
  ReverseJournalEntryDto,
} from './ledger.dto';
import { LedgerService } from './ledger.service';

@Controller('journal-entries')
export class JournalEntriesController {
  constructor(private readonly ledger: LedgerService) {}

  @Get()
  @RequirePermission('ledger:read')
  async list(@Query() query: ListJournalEntriesDto) {
    return { entries: await this.ledger.list(query) };
  }

  @Get(':id')
  @RequirePermission('ledger:read')
  find(@Param('id') id: string) {
    return this.ledger.find(id);
  }

  @Post()
  @RequirePermission('ledger:post')
  create(@Body() input: CreateJournalEntryDto) {
    return this.ledger.post(input);
  }

  @Post(':id/reverse')
  @RequirePermission('ledger:post')
  reverse(@Param('id') id: string, @Body() input: ReverseJournalEntryDto) {
    return this.ledger.reverse(id, input);
  }
}
