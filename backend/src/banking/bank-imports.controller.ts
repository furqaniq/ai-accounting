import {
  Body,
  Controller,
  HttpCode,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RequirePermission } from '../tenant/require-permission.decorator';
import { BankImportConfirmDto, BankImportPreviewDto } from './bank-import.dto';
import {
  BankImportConfirmResult,
  BankImportPreview,
  BankImportService,
} from './bank-import.service';

const MAX_BANK_FILE_BYTES = 10 * 1024 * 1024;

@Controller('bank-imports')
export class BankImportsController {
  constructor(private readonly imports: BankImportService) {}

  @Post('preview')
  @HttpCode(200)
  @RequirePermission('banking:manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BANK_FILE_BYTES } }))
  preview(
    @Body() input: BankImportPreviewDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<BankImportPreview> {
    return this.imports.preview(file, input);
  }

  @Post()
  @RequirePermission('banking:manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BANK_FILE_BYTES } }))
  confirm(
    @Body() input: BankImportConfirmDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<BankImportConfirmResult> {
    return this.imports.import(file, input);
  }
}
