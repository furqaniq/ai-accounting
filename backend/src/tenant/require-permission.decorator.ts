import { SetMetadata } from '@nestjs/common';
import { Permission } from './permissions';

export const REQUIRED_PERMISSIONS_KEY = 'requiredPermissions';

export const RequirePermission = (
  ...permissions: Permission[]
): MethodDecorator & ClassDecorator => SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);
