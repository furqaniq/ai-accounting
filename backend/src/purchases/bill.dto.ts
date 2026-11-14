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

export class BillLineDto {
  @IsString()
  @Length(1, 200)
  description!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100000)
  quantity!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10000000)
  unitPrice!: number;

  @IsString()
  expenseAccountId!: string;
}

export class CreateBillDto {
  @IsString()
  vendorId!: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'issueDate must be YYYY-MM-DD' })
  issueDate?: string;

  @IsString()
  @Matches(DATE_PATTERN, { message: 'dueDate must be YYYY-MM-DD' })
  dueDate!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BillLineDto)
  lines!: BillLineDto[];

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1)
  taxRate?: number;

  @IsOptional()
  @IsString()
  @Length(1, 1000)
  notes?: string;
}

export class UpdateBillDto {
  @IsOptional()
  @IsString()
  vendorId?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'issueDate must be YYYY-MM-DD' })
  issueDate?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'dueDate must be YYYY-MM-DD' })
  dueDate?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BillLineDto)
  lines?: BillLineDto[];

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1)
  taxRate?: number;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  notes?: string;
}

export class ListBillsDto {
  @IsOptional()
  @IsIn(['DRAFT', 'OPEN', 'PARTIAL', 'PAID', 'OVERDUE'])
  status?: 'DRAFT' | 'OPEN' | 'PARTIAL' | 'PAID' | 'OVERDUE';

  @IsOptional()
  @IsString()
  vendorId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  search?: string;
}
