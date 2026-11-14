import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const METHODS = ['CASH', 'CHECK', 'BANK_TRANSFER', 'CARD', 'OTHER'] as const;

export class PaymentApplicationDto {
  @IsString()
  invoiceId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(10000000)
  amount!: number;
}

export class CreatePaymentDto {
  @IsString()
  customerId!: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'date must be YYYY-MM-DD' })
  date?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(10000000)
  amount!: number;

  @IsOptional()
  @IsIn(METHODS)
  method?: (typeof METHODS)[number];

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
  @Type(() => PaymentApplicationDto)
  applications!: PaymentApplicationDto[];
}

export class ListPaymentsDto {
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  search?: string;
}
