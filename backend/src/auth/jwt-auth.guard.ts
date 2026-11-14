import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { PrismaService } from '../prisma/prisma.service';
import { resolveMembership } from '../tenant/membership-resolution';
import { hasPermission, Permission } from '../tenant/permissions';
import { REQUIRED_PERMISSIONS_KEY } from '../tenant/require-permission.decorator';
import { ORGANIZATION_HEADER, TenantRequest } from '../tenant/tenant-context.service';

export const IS_PUBLIC_KEY = 'isPublic';

export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const authenticated = (await super.canActivate(context)) as boolean;
    if (!authenticated) return false;

    const required =
      this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    if (required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<TenantRequest>();
    if (!request.user) {
      throw new UnauthorizedException();
    }

    const header = request.headers[ORGANIZATION_HEADER];
    const organizationId = Array.isArray(header) ? header[0] : header;
    if (!organizationId) {
      throw new BadRequestException('Active organization is required');
    }

    const membership = await resolveMembership(this.prisma, request.user.userId, organizationId);
    if (!membership) {
      throw new ForbiddenException('Organization not accessible');
    }
    request.tenantMembership = membership;

    for (const permission of required) {
      if (!hasPermission(membership.role, permission)) {
        throw new ForbiddenException('You do not have permission to perform this action');
      }
    }
    return true;
  }
}
