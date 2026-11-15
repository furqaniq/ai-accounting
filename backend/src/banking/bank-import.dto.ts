import { IsNotEmpty, IsOptional, IsString, Length } from 'class-validator';

export class BankImportPreviewDto {
  @IsString()
  @IsNotEmpty()
  bankAccountId!: string;

  @IsOptional()
  @IsString()
  dateColumn?: string;

  @IsOptional()
  @IsString()
  descriptionColumn?: string;

  @IsOptional()
  @IsString()
  amountColumn?: string;

  @IsOptional()
  @IsString()
  debitColumn?: string;

  @IsOptional()
  @IsString()
  creditColumn?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  externalIdColumn?: string;
}

export class BankImportConfirmDto extends BankImportPreviewDto {}
