import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { AccountType } from '@prisma/client';

const CODE_PATTERN = /^[0-9]{1,10}(\.[0-9]{1,4})?$/;

export class CreateAccountDto {
  @IsString()
  @Matches(CODE_PATTERN, { message: 'code must be numeric, optionally with a decimal part' })
  code!: string;

  @IsString()
  @Length(1, 120)
  name!: string;

  @IsEnum(AccountType)
  type!: AccountType;

  @IsOptional()
  @IsString()
  @Length(1, 60)
  subtype?: string;
}

export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  @Matches(CODE_PATTERN, { message: 'code must be numeric, optionally with a decimal part' })
  code?: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @IsEnum(AccountType)
  type?: AccountType;

  @IsOptional()
  @IsString()
  @Length(1, 60)
  subtype?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ListAccountsDto {
  @IsOptional()
  @IsEnum(AccountType)
  type?: AccountType;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  active?: boolean;
}
