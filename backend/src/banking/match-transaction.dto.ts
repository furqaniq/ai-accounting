import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { MatchEntityType } from './matching-engine';

export class MatchTransactionDto {
  @IsEnum(MatchEntityType)
  entityType!: MatchEntityType;

  @IsString()
  @IsNotEmpty()
  entityId!: string;
}
