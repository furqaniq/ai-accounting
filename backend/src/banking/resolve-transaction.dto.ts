import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class ResolveCategorizationDto {
  @IsString()
  @IsNotEmpty()
  accountId!: string;
}

export class ResolveTransferDto {
  @IsString()
  @IsNotEmpty()
  bankAccountId!: string;
}

export class ResolveExpenseDto {
  @IsString()
  @IsNotEmpty()
  categoryAccountId!: string;

  @IsOptional()
  @IsString()
  vendorId?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  memo?: string;
}

export class ResolvePaymentApplicationDto {
  @IsString()
  @IsNotEmpty()
  invoiceId!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(10000000)
  amount!: number;
}

export class ResolvePaymentDto {
  @IsString()
  @IsNotEmpty()
  customerId!: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  reference?: string;

  @IsOptional()
  @IsString()
  @Length(1, 1000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ResolvePaymentApplicationDto)
  applications!: ResolvePaymentApplicationDto[];
}
