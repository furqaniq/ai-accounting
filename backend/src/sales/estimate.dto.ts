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

export class EstimateLineDto {
  @IsString()
  itemId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100000)
  quantity!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10000000)
  unitPrice?: number;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  description?: string;
}

export class CreateEstimateDto {
  @IsString()
  customerId!: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'issueDate must be YYYY-MM-DD' })
  issueDate?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'expiryDate must be YYYY-MM-DD' })
  expiryDate?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => EstimateLineDto)
  lines!: EstimateLineDto[];

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

export class UpdateEstimateDto {
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'issueDate must be YYYY-MM-DD' })
  issueDate?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'expiryDate must be YYYY-MM-DD' })
  expiryDate?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => EstimateLineDto)
  lines?: EstimateLineDto[];

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

export class UpdateEstimateStatusDto {
  @IsIn(['SENT', 'ACCEPTED', 'DECLINED'])
  status!: 'SENT' | 'ACCEPTED' | 'DECLINED';
}

export class ListEstimatesDto {
  @IsOptional()
  @IsIn(['DRAFT', 'SENT', 'ACCEPTED', 'DECLINED'])
  status?: 'DRAFT' | 'SENT' | 'ACCEPTED' | 'DECLINED';

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  search?: string;
}
