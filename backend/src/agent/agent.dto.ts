import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AgentJobStatus, AgentTrigger } from '@prisma/client';

export class CreateAgentPromptDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  prompt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  model?: string;
}

export class AgentLogQueryDto {
  @IsOptional()
  @IsEnum(AgentTrigger)
  trigger?: AgentTrigger;

  @IsOptional()
  @IsEnum(AgentJobStatus)
  status?: AgentJobStatus;

  @IsOptional()
  @IsString()
  jobId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
