import { PrismaClient } from '@prisma/client';

export interface ResolvedMembership {
  organizationId: string;
  organizationName: string;
  role: string;
}

/** One implementation of membership validation, shared by the guard and the tenant context. */
export async function resolveMembership(
  prisma: PrismaClient,
  userId: string | undefined,
  organizationId: string,
): Promise<ResolvedMembership | null> {
  if (!userId) return null;
  const membership = await prisma.orgMembership.findFirst({
    where: { organizationId, userId },
    include: { organization: true },
  });
  if (!membership) return null;
  return {
    organizationId: membership.organizationId,
    organizationName: membership.organization.name,
    role: membership.role,
  };
}
