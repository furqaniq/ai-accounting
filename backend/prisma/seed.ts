import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const PASSWORD = 'Passw0rd!2026';

const ORGANIZATIONS = ['Acme Services Co.', 'Nimbus Retail LLC'] as const;

interface SeedUser {
  email: string;
  name: string;
  memberships: Array<{ organization: (typeof ORGANIZATIONS)[number]; role: Role }>;
}

const USERS: SeedUser[] = [
  {
    email: 'owner@acme.test',
    name: 'Olive Owner',
    memberships: [
      { organization: 'Acme Services Co.', role: 'OWNER' },
      { organization: 'Nimbus Retail LLC', role: 'ACCOUNTANT' },
    ],
  },
  {
    email: 'accountant@acme.test',
    name: 'Ada Accountant',
    memberships: [{ organization: 'Acme Services Co.', role: 'ACCOUNTANT' }],
  },
  {
    email: 'staff@acme.test',
    name: 'Sam Staff',
    memberships: [{ organization: 'Acme Services Co.', role: 'STAFF' }],
  },
  {
    email: 'viewer@acme.test',
    name: 'Vic Viewer',
    memberships: [{ organization: 'Acme Services Co.', role: 'VIEWER' }],
  },
  {
    email: 'owner@nimbus.test',
    name: 'Noah Nimbus',
    memberships: [{ organization: 'Nimbus Retail LLC', role: 'OWNER' }],
  },
  {
    email: 'accountant@nimbus.test',
    name: 'Nina Ledger',
    memberships: [{ organization: 'Nimbus Retail LLC', role: 'ACCOUNTANT' }],
  },
];

async function main(): Promise<void> {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const orgs = new Map<string, string>();
  for (const name of ORGANIZATIONS) {
    let org = await prisma.organization.findFirst({ where: { name } });
    if (!org) {
      org = await prisma.organization.create({ data: { name } });
    }
    orgs.set(name, org.id);
  }

  for (const seed of USERS) {
    const user = await prisma.user.upsert({
      where: { email: seed.email },
      update: { name: seed.name, passwordHash },
      create: { email: seed.email, name: seed.name, passwordHash },
    });

    for (const membership of seed.memberships) {
      const organizationId = orgs.get(membership.organization);
      if (!organizationId) throw new Error(`Missing organization ${membership.organization}`);
      await prisma.orgMembership.upsert({
        where: { userId_organizationId: { userId: user.id, organizationId } },
        update: { role: membership.role },
        create: { userId: user.id, organizationId, role: membership.role },
      });
    }

    console.log(`Seeded ${seed.email} (${seed.memberships.map((m) => m.organization).join(', ')})`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
