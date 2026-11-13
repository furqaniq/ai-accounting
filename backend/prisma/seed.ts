import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const OWNER_EMAIL = 'owner@acme.test';
const OWNER_NAME = 'Olive Owner';
const OWNER_PASSWORD = 'Passw0rd!2026';
const ACME_NAME = 'Acme Services Co.';

async function main(): Promise<void> {
  const passwordHash = await bcrypt.hash(OWNER_PASSWORD, 10);

  const owner = await prisma.user.upsert({
    where: { email: OWNER_EMAIL },
    update: {},
    create: { email: OWNER_EMAIL, name: OWNER_NAME, passwordHash },
  });

  let acme = await prisma.organization.findFirst({ where: { name: ACME_NAME } });
  if (!acme) {
    acme = await prisma.organization.create({ data: { name: ACME_NAME } });
  }

  await prisma.orgMembership.upsert({
    where: { userId_organizationId: { userId: owner.id, organizationId: acme.id } },
    update: { role: 'OWNER' },
    create: { userId: owner.id, organizationId: acme.id, role: 'OWNER' },
  });

  console.log(`Seeded ${OWNER_EMAIL} in ${ACME_NAME}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
