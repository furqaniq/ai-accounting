import { Module } from '@nestjs/common';
import { TenantModule } from '../tenant/tenant.module';
import { ATTACHMENT_STORE } from './attachment-store';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import { MemoryAttachmentStore } from './memory-attachment.store';
import { MinioAttachmentStore } from './minio-attachment.store';

@Module({
  imports: [TenantModule],
  controllers: [AttachmentsController],
  providers: [
    AttachmentsService,
    {
      provide: ATTACHMENT_STORE,
      useFactory: () =>
        process.env.ATTACHMENT_DRIVER === 'memory'
          ? new MemoryAttachmentStore()
          : new MinioAttachmentStore(),
    },
  ],
})
export class AttachmentsModule {}
