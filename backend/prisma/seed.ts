import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { ensureDefaultChart } from '../src/accounts/default-chart';
import { postEntry } from '../src/ledger/ledger-engine';

const prisma = new PrismaClient();

const PASSWORD = 'Passw0rd!2026';

const ORGANIZATIONS = ['Acme Services Co.', 'Nimbus Retail LLC'] as const;

const OPENING_BALANCES: Record<(typeof ORGANIZATIONS)[number], number> = {
  'Acme Services Co.': 5000,
  'Nimbus Retail LLC': 3200,
};

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
    await ensureDefaultChart(prisma, org.id);
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

  for (const name of ORGANIZATIONS) {
    const organizationId = orgs.get(name);
    if (!organizationId) throw new Error(`Missing organization ${name}`);
    const existing = await prisma.journalEntry.findFirst({
      where: { organizationId, memo: 'Opening balance' },
    });
    if (existing) continue;

    const [cash, equity] = await Promise.all([
      prisma.account.findFirstOrThrow({ where: { organizationId, code: '1000' } }),
      prisma.account.findFirstOrThrow({ where: { organizationId, code: '3000' } }),
    ]);
    await postEntry(prisma, organizationId, {
      date: '2026-01-02',
      memo: 'Opening balance',
      lines: [
        { accountId: cash.id, debit: OPENING_BALANCES[name], description: 'Cash brought forward' },
        { accountId: equity.id, credit: OPENING_BALANCES[name], description: 'Owner equity' },
      ],
    });
    console.log(`Seeded opening balance for ${name}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
