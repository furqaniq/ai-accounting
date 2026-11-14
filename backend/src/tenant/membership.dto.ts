import { Role } from '@prisma/client';
import { IsEmail, IsEnum } from 'class-validator';

export class CreateMembershipDto {
  @IsEmail()
  email!: string;

  @IsEnum(Role)
  role!: Role;
}

export class UpdateMembershipRoleDto {
  @IsEnum(Role)
  role!: Role;
}
