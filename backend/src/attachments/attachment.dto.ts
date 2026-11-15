import { AttachmentEntityType } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AttachmentTargetDto {
  @IsEnum(AttachmentEntityType)
  entityType!: AttachmentEntityType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  entityId!: string;
}

export class UploadAttachmentDto extends AttachmentTargetDto {}
export class ListAttachmentsDto extends AttachmentTargetDto {}
