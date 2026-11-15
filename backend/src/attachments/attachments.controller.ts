import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { RequirePermission } from '../tenant/require-permission.decorator';
import { MAX_ATTACHMENT_BYTES } from './attachment-file';
import { ListAttachmentsDto, UploadAttachmentDto } from './attachment.dto';
import {
  AttachmentView,
  AttachmentsService,
} from './attachments.service';

@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Get()
  @RequirePermission('attachments:read')
  async list(
    @Query() query: ListAttachmentsDto,
  ): Promise<{ attachments: AttachmentView[] }> {
    return { attachments: await this.attachments.list(query) };
  }

  @Post()
  @RequirePermission('attachments:manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT_BYTES } }))
  upload(
    @Body() input: UploadAttachmentDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<AttachmentView> {
    return this.attachments.upload(input, file);
  }

  @Get(':id/url')
  @RequirePermission('attachments:read')
  presignedUrl(@Param('id') id: string): Promise<{ url: string }> {
    return this.attachments.presignedUrl(id);
  }

  @Get(':id/download')
  @RequirePermission('attachments:read')
  async download(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.attachments.download(id);
    res.set({
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      'Content-Length': String(file.buffer.length),
    });
    return new StreamableFile(file.buffer);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('attachments:manage')
  remove(@Param('id') id: string): Promise<void> {
    return this.attachments.remove(id);
  }
}
