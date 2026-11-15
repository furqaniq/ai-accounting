import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Attachment, AttachmentEntityType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../tenant/audit.service';
import { ScopedDataAccess } from '../tenant/scoped-data-access.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { validateAttachmentFile } from './attachment-file';
import { AttachmentTargetDto } from './attachment.dto';
import { ATTACHMENT_STORE, AttachmentStore } from './attachment-store';

export interface AttachmentView {
  id: string;
  entityType: AttachmentEntityType;
  entityId: string;
  filename: string;
  contentType: string;
  size: number;
  createdAt: string;
}

export interface AttachmentDownload {
  filename: string;
  contentType: string;
  buffer: Buffer;
}

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly scoped: ScopedDataAccess,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    @Inject(ATTACHMENT_STORE) private readonly storage: AttachmentStore,
  ) {}

  async list(target: AttachmentTargetDto): Promise<AttachmentView[]> {
    await this.assertTarget(target);
    const rows = await this.scoped.findMany<Attachment>('attachment', {
      where: { entityType: target.entityType, entityId: target.entityId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.toView(row));
  }

  async upload(
    target: AttachmentTargetDto,
    file: Express.Multer.File | undefined,
  ): Promise<AttachmentView> {
    if (!file) throw new BadRequestException('Choose a file to attach');
    const validated = validateAttachmentFile(file);
    await this.assertTarget(target);

    const { organizationId } = await this.tenant.get();
    const id = randomUUID();
    const objectKey = `${organizationId}/${target.entityType.toLowerCase()}/${target.entityId}/${id}/${validated.filename}`;
    await this.storage.putObject(objectKey, file.buffer, validated.contentType);

    let created: Attachment;
    try {
      created = await this.scoped.create<Attachment>('attachment', {
        id,
        entityType: target.entityType,
        entityId: target.entityId,
        objectKey,
        filename: validated.filename,
        contentType: validated.contentType,
        size: validated.size,
      });
    } catch (error) {
      await this.storage.removeObject(objectKey).catch(() => undefined);
      throw error;
    }

    await this.audit.record('attachment.upload', 'Attachment', created.id, {
      entityType: created.entityType,
      entityId: created.entityId,
      filename: created.filename,
      contentType: created.contentType,
      size: created.size,
    });
    return this.toView(created);
  }

  async download(id: string): Promise<AttachmentDownload> {
    const row = await this.findRow(id);
    try {
      return {
        filename: row.filename,
        contentType: row.contentType,
        buffer: await this.storage.getObject(row.objectKey),
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new NotFoundException('Attachment file is not available');
    }
  }

  async presignedUrl(id: string): Promise<{ url: string }> {
    const row = await this.findRow(id);
    return {
      url: await this.storage.presignedGetUrl(row.objectKey, row.filename, row.contentType),
    };
  }

  async remove(id: string): Promise<void> {
    const row = await this.findRow(id);
    await this.storage.removeObject(row.objectKey);
    const deleted = await this.scoped.deleteById('attachment', row.id);
    if (!deleted) throw new NotFoundException('Attachment not found');
    await this.audit.record('attachment.delete', 'Attachment', row.id, {
      entityType: row.entityType,
      entityId: row.entityId,
      filename: row.filename,
    });
  }

  private async findRow(id: string): Promise<Attachment> {
    const row = await this.scoped.findById<Attachment>('attachment', id);
    if (!row) throw new NotFoundException('Attachment not found');
    return row;
  }

  private async assertTarget(target: AttachmentTargetDto): Promise<void> {
    const model = target.entityType === AttachmentEntityType.EXPENSE ? 'expense' : 'bill';
    const row = await this.scoped.findById<{ id: string }>(model, target.entityId, {
      select: { id: true },
    });
    if (!row) {
      throw new NotFoundException(
        target.entityType === AttachmentEntityType.EXPENSE
          ? 'Expense not found'
          : 'Bill not found',
      );
    }
  }

  private toView(row: Attachment): AttachmentView {
    return {
      id: row.id,
      entityType: row.entityType,
      entityId: row.entityId,
      filename: row.filename,
      contentType: row.contentType,
      size: row.size,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
