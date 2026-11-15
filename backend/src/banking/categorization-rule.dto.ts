import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateCategorizationRuleDto {
  @IsString()
  @Length(1, 120)
  descriptionContains!: string;

  @IsString()
  @IsNotEmpty()
  targetAccountId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  priority?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateCategorizationRuleDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  descriptionContains?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  targetAccountId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  priority?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
