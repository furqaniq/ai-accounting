import { Role } from '@prisma/client';

export const PERMISSIONS = [
  'org:read',
  'org:manage',
  'members:read',
  'members:manage',
  'audit:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * The single role → permission matrix. Endpoints declare the permission they
 * need; the guard checks the caller's membership role against this table.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  OWNER: ['org:read', 'org:manage', 'members:read', 'members:manage', 'audit:read'],
  ADMIN: ['org:read', 'org:manage', 'members:read', 'members:manage', 'audit:read'],
  ACCOUNTANT: ['org:read', 'members:read'],
  STAFF: ['org:read', 'members:read'],
  VIEWER: ['org:read', 'members:read'],
};

export function hasPermission(role: Role | string, permission: Permission): boolean {
  const granted = ROLE_PERMISSIONS[role as Role];
  return Array.isArray(granted) && granted.includes(permission);
}
