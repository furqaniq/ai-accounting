import {
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class CreateExpenseDto {
  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'date must be YYYY-MM-DD' })
  date?: string;

  @IsOptional()
  @IsString()
  vendorId?: string;

  @IsString()
  categoryAccountId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(10000000)
  amount!: number;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  memo?: string;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  receiptNote?: string;
}

export class UpdateExpenseDto {
  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'date must be YYYY-MM-DD' })
  date?: string;

  @IsOptional()
  @IsString()
  vendorId?: string;

  @IsOptional()
  @IsString()
  categoryAccountId?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(10000000)
  amount?: number;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  memo?: string;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  receiptNote?: string;
}

export class ListExpensesDto {
  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'to must be YYYY-MM-DD' })
  to?: string;

  @IsOptional()
  @IsString()
  vendorId?: string;

  @IsOptional()
  @IsString()
  categoryAccountId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  search?: string;
}
