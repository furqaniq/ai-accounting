import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export class AuditQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/^[a-z]+(\.[a-z_]+)+$/, { message: 'action must look like entity.event' })
  action?: string;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
