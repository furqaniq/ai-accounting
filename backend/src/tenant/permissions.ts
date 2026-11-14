import { Role } from '@prisma/client';

export const PERMISSIONS = [
  'org:read',
  'org:manage',
  'members:read',
  'members:manage',
  'audit:read',
  'accounts:read',
  'accounts:manage',
  'ledger:read',
  'ledger:post',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * The single role → permission matrix. Endpoints declare the permission they
 * need; the guard checks the caller's membership role against this table.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  OWNER: [
    'org:read',
    'org:manage',
    'members:read',
    'members:manage',
    'audit:read',
    'accounts:read',
    'accounts:manage',
    'ledger:read',
    'ledger:post',
  ],
  ADMIN: [
    'org:read',
    'org:manage',
    'members:read',
    'members:manage',
    'audit:read',
    'accounts:read',
    'accounts:manage',
    'ledger:read',
    'ledger:post',
  ],
  ACCOUNTANT: [
    'org:read',
    'members:read',
    'accounts:read',
    'accounts:manage',
    'ledger:read',
    'ledger:post',
  ],
  STAFF: ['org:read', 'members:read', 'accounts:read', 'ledger:read'],
  VIEWER: ['org:read', 'members:read', 'accounts:read', 'ledger:read'],
};

export function hasPermission(role: Role | string, permission: Permission): boolean {
  const granted = ROLE_PERMISSIONS[role as Role];
  return Array.isArray(granted) && granted.includes(permission);
}
