import { Module } from '@nestjs/common';
import { TenantModule } from '../tenant/tenant.module';
import { JournalEntriesController } from './journal-entries.controller';
import { LedgerController } from './ledger.controller';
import { LedgerEngine } from './ledger-engine';
import { LedgerService } from './ledger.service';

@Module({
  imports: [TenantModule],
  controllers: [JournalEntriesController, LedgerController],
  providers: [LedgerEngine, LedgerService],
  exports: [LedgerEngine, LedgerService],
})
export class LedgerModule {}
