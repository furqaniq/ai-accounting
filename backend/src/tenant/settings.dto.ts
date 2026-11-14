import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

export class UpdateOrganizationSettingsDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  fiscalYearStartMonth?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(31)
  fiscalYearStartDay?: number;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'baseCurrency must be a three-letter code' })
  baseCurrency?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1)
  defaultTaxRate?: number;
}
