import { BankAccountType } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsString, Length } from 'class-validator';

export class CreateBankAccountDto {
  @IsString()
  @Length(1, 120)
  name!: string;

  @IsEnum(BankAccountType)
  type!: BankAccountType;

  @IsString()
  @IsNotEmpty()
  ledgerAccountId!: string;
}
