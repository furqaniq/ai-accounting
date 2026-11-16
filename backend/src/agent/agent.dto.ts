import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  AgentDomainEventType,
  AgentJobStatus,
  AgentProposalStatus,
  AgentTrigger,
} from '@prisma/client';

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

export class AgentApprovalQueryDto {
  @IsOptional()
  @IsEnum(AgentProposalStatus)
  status?: AgentProposalStatus;

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

export class RejectAgentProposalDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class UpdateAgentPolicyDto {
  @IsIn(['auto', 'approve'])
  policy!: 'auto' | 'approve';
}

export class CreateAgentAutomationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  prompt!: string;

  @IsOptional()
  @IsIn(['CRON', 'EVENT'])
  mode?: 'CRON' | 'EVENT';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  cron?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  timezone?: string;

  @IsOptional()
  @IsEnum(AgentDomainEventType)
  eventType?: AgentDomainEventType;

  @IsOptional()
  @IsObject()
  eventConfig?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  model?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateAgentAutomationDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  prompt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  cron?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  timezone?: string;

  @IsOptional()
  @IsEnum(AgentDomainEventType)
  eventType?: AgentDomainEventType;

  @IsOptional()
  @IsObject()
  eventConfig?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  model?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class FireDomainEventDto {
  @IsEnum(AgentDomainEventType)
  type!: AgentDomainEventType;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  entityId?: string;

  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}
