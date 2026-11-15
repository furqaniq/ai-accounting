import { Type } from 'class-transformer';
import { ReconciliationStatus } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_AMOUNT = 100000000;

export class CreateReconciliationDto {
  @IsString()
  @IsNotEmpty()
  bankAccountId!: string;

  @IsString()
  @Matches(DATE_PATTERN, { message: 'periodStart must be YYYY-MM-DD' })
  periodStart!: string;

  @IsString()
  @Matches(DATE_PATTERN, { message: 'periodEnd must be YYYY-MM-DD' })
  periodEnd!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-MAX_AMOUNT)
  @Max(MAX_AMOUNT)
  statementEndingBalance!: number;
}

export class ListReconciliationsDto {
  @IsOptional()
  @IsString()
  bankAccountId?: string;

  @IsOptional()
  @IsEnum(ReconciliationStatus)
  status?: ReconciliationStatus;
}

export class SetReconciliationClearedDto {
  @IsBoolean()
  cleared!: boolean;
}
