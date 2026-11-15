import { IsOptional, IsString, Matches } from 'class-validator';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class PeriodQueryDto {
  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}

export class AsOfQueryDto {
  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'asOf must be YYYY-MM-DD' })
  asOf?: string;
}
