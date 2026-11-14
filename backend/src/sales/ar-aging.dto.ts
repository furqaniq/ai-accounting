import { IsOptional, IsString, Matches } from 'class-validator';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class ArAgingQueryDto {
  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN, { message: 'asOf must be YYYY-MM-DD' })
  asOf?: string;
}
