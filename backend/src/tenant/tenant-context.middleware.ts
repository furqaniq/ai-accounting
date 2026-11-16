import { Injectable, NestMiddleware } from '@nestjs/common';
import { TenantContextService, TenantRequest } from './tenant-context.service';

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(private readonly tenant: TenantContextService) {}

  use(request: TenantRequest, _response: unknown, next: () => void): void {
    this.tenant.runWithRequest(request, next);
  }
}
