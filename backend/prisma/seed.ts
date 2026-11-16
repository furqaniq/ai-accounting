import {
  AgentAutomationMode,
  BankAccountType,
  BankImportFormat,
  BankTransactionMatchState,
  BillStatus,
  EstimateStatus,
  InvoiceStatus,
  JournalSourceType,
  Prisma,
  PrismaClient,
  ReconciliationStatus,
  Role,
} from '@prisma/client';
import bcrypt from 'bcryptjs';
import { Queue } from 'bullmq';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDefaultChart } from '../src/accounts/default-chart';
import { BankingImportEngine } from '../src/banking/banking-import.engine';
import { postEntry } from '../src/ledger/ledger-engine';

const prisma = new PrismaClient();

const PASSWORD = 'Passw0rd!2026';

const ORGANIZATIONS = ['Acme Services Co.', 'Nimbus Retail LLC'] as const;

const OWNER_EMAILS: Record<(typeof ORGANIZATIONS)[number], string> = {
  'Acme Services Co.': 'owner@acme.test',
  'Nimbus Retail LLC': 'owner@nimbus.test',
};

const BANK_CSV_FILES: Record<(typeof ORGANIZATIONS)[number], string> = {
  'Acme Services Co.': 'demo-acme-checking-october.csv',
  'Nimbus Retail LLC': 'demo-nimbus-checking-october.csv',
};

const DEMO_BANK_ACCOUNT_NAME = 'Operating checking';
const DEMO_BATCH_FILENAME = 'demo-checking-october.csv';
const DEMO_TRANSFER_MEMO = 'Seed transfer to checking';
const DEMO_TRANSFER_DATE = '2026-09-30';
const DEMO_TRANSFER_AMOUNT = 500;
const DEMO_BANK_DATE = '2026-10-20';
const DEMO_RECON_PERIOD_START = '2026-10-01';
const DEMO_RECON_PERIOD_END = '2026-10-31';
const DEMO_RECON_CLEARED_AT = '2026-10-31T12:00:00.000Z';
const DEMO_RECON_COMPLETED_AT = '2026-11-01T12:00:00.000Z';
const DEMO_AUTOMATION_NAME = 'Weekly cash review';
const DEMO_AUTOMATION_PROMPT =
  'Review cash and receivables for the week and flag anything that needs attention.';
const DEMO_AUTOMATION_CRON = '0 9 * * 1';
const DEMO_AUTOMATION_TIMEZONE = 'UTC';

function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/**
 * Best-effort schedule registration so a seeded cron row starts running in
 * Compose. Jest and Redis-less local runs stay usable because failure is a
 * warning, never a seed failure.
 */
async function registerAutomationSchedule(
  automationId: string,
  organizationId: string,
): Promise<void> {
  if ((process.env.AGENT_QUEUE_DRIVER ?? 'bull') === 'inline') return;
  const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  const db = url.pathname.replace('/', '');
  const queue = new Queue('agent-automations', {
    connection: {
      host: url.hostname,
      port: Number.parseInt(url.port || '6379', 10),
      username: url.username || undefined,
      password: url.password || undefined,
      db: db ? Number.parseInt(db, 10) : undefined,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 2000,
    },
  });
  queue.on('error', () => undefined);
  try {
    await Promise.race([
      queue.upsertJobScheduler(
        automationId,
        { pattern: DEMO_AUTOMATION_CRON, tz: DEMO_AUTOMATION_TIMEZONE },
        {
          name: 'automation',
          data: { automationId, organizationId },
        },
      ),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Redis is unavailable')), 3000),
      ),
    ]);
  } catch (error) {
    console.warn(
      `Skipped scheduler registration for ${automationId}: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
  } finally {
    await Promise.race([
      queue.close().catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
  }
}

const OPENING_BALANCES: Record<(typeof ORGANIZATIONS)[number], number> = {
  'Acme Services Co.': 5000,
  'Nimbus Retail LLC': 3200,
};

interface SeedUser {
  email: string;
  name: string;
  memberships: Array<{ organization: (typeof ORGANIZATIONS)[number]; role: Role }>;
}

interface SeedCustomer {
  code: string;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}

const CUSTOMERS: Record<(typeof ORGANIZATIONS)[number], SeedCustomer[]> = {
  'Acme Services Co.': [
    {
      code: 'CUST-0001',
      name: 'Northwind Studio',
      contactName: 'Nora North',
      email: 'billing@northwind.test',
      phone: '555-0142',
      city: 'Portland',
      region: 'OR',
      postalCode: '97205',
      country: 'United States',
    },
    {
      code: 'CUST-0002',
      name: 'Harbor & Pine',
      contactName: 'Hana Pine',
      email: 'accounts@harborpine.test',
      phone: '555-0177',
      city: 'Seattle',
      region: 'WA',
      postalCode: '98101',
      country: 'United States',
    },
  ],
  'Nimbus Retail LLC': [
    {
      code: 'CUST-0001',
      name: 'Cedar Market',
      contactName: 'Casey Cedar',
      email: 'ap@cedarmarket.test',
      phone: '555-0198',
      city: 'Austin',
      region: 'TX',
      postalCode: '78701',
      country: 'United States',
    },
  ],
};

interface SeedItem {
  code: string;
  name: string;
  description: string;
  price: number;
  taxable: boolean;
}

const ITEMS: Record<(typeof ORGANIZATIONS)[number], SeedItem[]> = {
  'Acme Services Co.': [
    {
      code: 'ITEM-0001',
      name: 'Consulting hour',
      description: 'Advisory work billed by the hour',
      price: 150,
      taxable: false,
    },
    {
      code: 'ITEM-0002',
      name: 'Design package',
      description: 'Fixed-scope design engagement',
      price: 900,
      taxable: true,
    },
    {
      code: 'ITEM-0003',
      name: 'Support retainer',
      description: 'Monthly support retainer',
      price: 450,
      taxable: false,
    },
  ],
  'Nimbus Retail LLC': [
    {
      code: 'ITEM-0001',
      name: 'Retail bundle',
      description: 'Assorted retail goods',
      price: 120,
      taxable: true,
    },
    {
      code: 'ITEM-0002',
      name: 'Gift wrapping',
      description: 'Optional wrapping service',
      price: 8,
      taxable: false,
    },
  ],
};

interface SeedInvoiceLine {
  itemCode: string;
  quantity: number;
  unitPrice?: number;
  description?: string;
}

interface SeedInvoice {
  number: string;
  customerCode: string;
  issueDate: string;
  dueDate: string;
  status: InvoiceStatus;
  taxRate: number;
  notes: string;
  lines: SeedInvoiceLine[];
}

const INVOICES: Record<(typeof ORGANIZATIONS)[number], SeedInvoice[]> = {
  'Acme Services Co.': [
    {
      number: 'INV-1001',
      customerCode: 'CUST-0001',
      issueDate: '2026-10-20',
      dueDate: '2026-11-19',
      status: InvoiceStatus.SENT,
      taxRate: 0,
      notes: 'October advisory work',
      lines: [{ itemCode: 'ITEM-0001', quantity: 2 }],
    },
    {
      number: 'INV-1002',
      customerCode: 'CUST-0002',
      issueDate: '2026-09-15',
      dueDate: '2026-10-15',
      status: InvoiceStatus.SENT,
      taxRate: 0.0825,
      notes: 'Design engagement',
      lines: [{ itemCode: 'ITEM-0002', quantity: 1 }],
    },
    {
      number: 'INV-1003',
      customerCode: 'CUST-0001',
      issueDate: '2026-11-05',
      dueDate: '2026-12-05',
      status: InvoiceStatus.DRAFT,
      taxRate: 0,
      notes: 'Draft retainer',
      lines: [{ itemCode: 'ITEM-0003', quantity: 1 }],
    },
  ],
  'Nimbus Retail LLC': [
    {
      number: 'INV-1001',
      customerCode: 'CUST-0001',
      issueDate: '2026-10-01',
      dueDate: '2026-10-31',
      status: InvoiceStatus.SENT,
      taxRate: 0.0825,
      notes: 'October retail order',
      lines: [{ itemCode: 'ITEM-0001', quantity: 2 }],
    },
    {
      number: 'INV-1002',
      customerCode: 'CUST-0001',
      issueDate: '2026-11-08',
      dueDate: '2026-12-08',
      status: InvoiceStatus.DRAFT,
      taxRate: 0,
      notes: 'Gift wrapping draft',
      lines: [{ itemCode: 'ITEM-0002', quantity: 3 }],
    },
  ],
};


interface SeedVendor {
  code: string;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}

const VENDORS: Record<(typeof ORGANIZATIONS)[number], SeedVendor[]> = {
  'Acme Services Co.': [
    {
      code: 'VEND-0001',
      name: 'Halden Paper',
      contactName: 'Hale Morgan',
      email: 'ap@haldenpaper.test',
      phone: '555-0133',
      city: 'Tacoma',
      region: 'WA',
      postalCode: '98402',
      country: 'United States',
    },
    {
      code: 'VEND-0002',
      name: 'Brightline Utilities',
      contactName: 'Bri Lewis',
      email: 'billing@brightline.test',
      phone: '555-0164',
      city: 'Portland',
      region: 'OR',
      postalCode: '97204',
      country: 'United States',
    },
  ],
  'Nimbus Retail LLC': [
    {
      code: 'VEND-0001',
      name: 'Ridge Supply Co.',
      contactName: 'Rae Ridge',
      email: 'orders@ridgesupply.test',
      phone: '555-0188',
      city: 'Dallas',
      region: 'TX',
      postalCode: '75201',
      country: 'United States',
    },
  ],
};

interface SeedBillLine {
  description: string;
  quantity: number;
  unitPrice: number;
  expenseCode: string;
}

interface SeedBill {
  number: string;
  vendorCode: string;
  issueDate: string;
  dueDate: string;
  status: BillStatus;
  taxRate: number;
  notes: string;
  lines: SeedBillLine[];
}

const BILLS: Record<(typeof ORGANIZATIONS)[number], SeedBill[]> = {
  'Acme Services Co.': [
    {
      number: 'BILL-1001',
      vendorCode: 'VEND-0001',
      issueDate: '2026-10-20',
      dueDate: '2026-11-19',
      status: BillStatus.OPEN,
      taxRate: 0.0825,
      notes: 'October paper order',
      lines: [
        { description: 'Paper stock', quantity: 2, unitPrice: 300, expenseCode: '6200' },
      ],
    },
    {
      number: 'BILL-1002',
      vendorCode: 'VEND-0002',
      issueDate: '2026-09-15',
      dueDate: '2026-10-15',
      status: BillStatus.OPEN,
      taxRate: 0,
      notes: 'September utilities',
      lines: [{ description: 'Electricity', quantity: 1, unitPrice: 475, expenseCode: '6100' }],
    },
    {
      number: 'BILL-1003',
      vendorCode: 'VEND-0001',
      issueDate: '2026-11-05',
      dueDate: '2026-12-05',
      status: BillStatus.DRAFT,
      taxRate: 0,
      notes: 'Draft supplies order',
      lines: [{ description: 'Envelopes', quantity: 1, unitPrice: 220, expenseCode: '6200' }],
    },
  ],
  'Nimbus Retail LLC': [
    {
      number: 'BILL-1001',
      vendorCode: 'VEND-0001',
      issueDate: '2026-10-01',
      dueDate: '2026-10-31',
      status: BillStatus.OPEN,
      taxRate: 0.0825,
      notes: 'October packaging',
      lines: [{ description: 'Shipping cartons', quantity: 1, unitPrice: 300, expenseCode: '6200' }],
    },
    {
      number: 'BILL-1002',
      vendorCode: 'VEND-0001',
      issueDate: '2026-11-08',
      dueDate: '2026-12-08',
      status: BillStatus.DRAFT,
      taxRate: 0,
      notes: 'Draft packaging order',
      lines: [{ description: 'Tissue paper', quantity: 1, unitPrice: 140, expenseCode: '6200' }],
    },
  ],
};

interface SeedEstimate {
  number: string;
  customerCode: string;
  issueDate: string;
  expiryDate: string;
  status: EstimateStatus;
  taxRate: number;
  notes: string;
  lines: SeedInvoiceLine[];
}

const ESTIMATES: Record<(typeof ORGANIZATIONS)[number], SeedEstimate[]> = {
  'Acme Services Co.': [
    {
      number: 'EST-1001',
      customerCode: 'CUST-0001',
      issueDate: '2026-11-02',
      expiryDate: '2026-12-02',
      status: EstimateStatus.SENT,
      taxRate: 0,
      notes: 'Quarterly advisory proposal',
      lines: [
        { itemCode: 'ITEM-0001', quantity: 6 },
        { itemCode: 'ITEM-0003', quantity: 1 },
      ],
    },
    {
      number: 'EST-1002',
      customerCode: 'CUST-0002',
      issueDate: '2026-11-09',
      expiryDate: '2026-12-09',
      status: EstimateStatus.DRAFT,
      taxRate: 0.0825,
      notes: 'Design package quote',
      lines: [{ itemCode: 'ITEM-0002', quantity: 2 }],
    },
  ],
  'Nimbus Retail LLC': [
    {
      number: 'EST-1001',
      customerCode: 'CUST-0001',
      issueDate: '2026-11-04',
      expiryDate: '2026-12-04',
      status: EstimateStatus.ACCEPTED,
      taxRate: 0.0825,
      notes: 'Holiday bundle quote',
      lines: [{ itemCode: 'ITEM-0001', quantity: 4 }],
    },
  ],
};

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

  const userIds = new Map<string, string>();
  for (const seed of USERS) {
    const user = await prisma.user.upsert({
      where: { email: seed.email },
      update: { name: seed.name, passwordHash },
      create: { email: seed.email, name: seed.name, passwordHash },
    });
    userIds.set(seed.email, user.id);

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

  for (const name of ORGANIZATIONS) {
    const organizationId = orgs.get(name);
    if (!organizationId) throw new Error(`Missing organization ${name}`);

    for (const customer of CUSTOMERS[name]) {
      await prisma.customer.upsert({
        where: { organizationId_code: { organizationId, code: customer.code } },
        update: {
          name: customer.name,
          contactName: customer.contactName,
          email: customer.email,
          phone: customer.phone,
          city: customer.city,
          region: customer.region,
          postalCode: customer.postalCode,
          country: customer.country,
        },
        create: {
          organizationId,
          code: customer.code,
          name: customer.name,
          contactName: customer.contactName,
          email: customer.email,
          phone: customer.phone,
          city: customer.city,
          region: customer.region,
          postalCode: customer.postalCode,
          country: customer.country,
        },
      });
    }
    console.log(`Seeded ${CUSTOMERS[name].length} customers for ${name}`);

    for (const vendor of VENDORS[name]) {
      await prisma.vendor.upsert({
        where: { organizationId_code: { organizationId, code: vendor.code } },
        update: {
          name: vendor.name,
          contactName: vendor.contactName,
          email: vendor.email,
          phone: vendor.phone,
          city: vendor.city,
          region: vendor.region,
          postalCode: vendor.postalCode,
          country: vendor.country,
        },
        create: {
          organizationId,
          code: vendor.code,
          name: vendor.name,
          contactName: vendor.contactName,
          email: vendor.email,
          phone: vendor.phone,
          city: vendor.city,
          region: vendor.region,
          postalCode: vendor.postalCode,
          country: vendor.country,
        },
      });
    }
    console.log(`Seeded ${VENDORS[name].length} vendors for ${name}`);

    const income = await prisma.account.findFirstOrThrow({
      where: { organizationId, code: '4000' },
    });
    for (const item of ITEMS[name]) {
      await prisma.item.upsert({
        where: { organizationId_code: { organizationId, code: item.code } },
        update: {
          name: item.name,
          description: item.description,
          price: item.price,
          incomeAccountId: income.id,
          taxable: item.taxable,
        },
        create: {
          organizationId,
          code: item.code,
          name: item.name,
          description: item.description,
          price: item.price,
          incomeAccountId: income.id,
          taxable: item.taxable,
        },
      });
    }
    console.log(`Seeded ${ITEMS[name].length} items for ${name}`);
  }

  for (const name of ORGANIZATIONS) {
    const organizationId = orgs.get(name);
    if (!organizationId) throw new Error(`Missing organization ${name}`);
    const existing = await prisma.invoice.count({ where: { organizationId } });
    if (existing > 0) continue;

    const [receivable, taxPayable, income] = await Promise.all([
      prisma.account.findFirstOrThrow({
        where: { organizationId, code: '1100', active: true },
      }),
      prisma.account.findFirstOrThrow({
        where: { organizationId, code: '2100', active: true },
      }),
      prisma.account.findFirstOrThrow({ where: { organizationId, code: '4000' } }),
    ]);

    for (const invoice of INVOICES[name]) {
      const customer = await prisma.customer.findFirstOrThrow({
        where: { organizationId, code: invoice.customerCode },
      });
      const lines = [];
      for (const [index, line] of invoice.lines.entries()) {
        const item = await prisma.item.findFirstOrThrow({
          where: { organizationId, code: line.itemCode },
        });
        const quantity = new Prisma.Decimal(line.quantity);
        const unitPrice = new Prisma.Decimal(line.unitPrice ?? item.price);
        lines.push({
          organizationId,
          position: index,
          itemId: item.id,
          description: line.description ?? item.name,
          quantity,
          unitPrice,
          amount: quantity.mul(unitPrice).toDecimalPlaces(2),
          taxable: item.taxable,
          incomeAccountId: item.incomeAccountId,
        });
      }

      const subtotal = lines.reduce(
        (sum, line) => sum.plus(line.amount),
        new Prisma.Decimal(0),
      );
      const taxable = lines.reduce(
        (sum, line) => (line.taxable ? sum.plus(line.amount) : sum),
        new Prisma.Decimal(0),
      );
      const taxRate = new Prisma.Decimal(invoice.taxRate);
      const taxTotal = taxable.mul(taxRate).toDecimalPlaces(2);
      const total = subtotal.plus(taxTotal);
      const sent = invoice.status !== InvoiceStatus.DRAFT;

      const created = await prisma.invoice.create({
        data: {
          organizationId,
          number: invoice.number,
          customerId: customer.id,
          status: InvoiceStatus.DRAFT,
          issueDate: new Date(`${invoice.issueDate}T00:00:00.000Z`),
          dueDate: new Date(`${invoice.dueDate}T00:00:00.000Z`),
          taxRate,
          subtotal,
          taxTotal,
          total,
          notes: invoice.notes,
          lines: { create: lines },
        },
      });

      if (sent) {
        const incomeByAccount = new Map<string, Prisma.Decimal>();
        for (const line of lines) {
          incomeByAccount.set(
            line.incomeAccountId,
            (incomeByAccount.get(line.incomeAccountId) ?? new Prisma.Decimal(0)).plus(
              line.amount,
            ),
          );
        }
        await postEntry(prisma, organizationId, {
          date: invoice.issueDate,
          memo: `Invoice ${created.number} — ${customer.name}`,
          sourceType: JournalSourceType.INVOICE,
          sourceId: created.id,
          lines: [
            { accountId: receivable.id, debit: total, description: `Invoice ${created.number}` },
            ...[...incomeByAccount.entries()].map(([accountId, amount]) => ({
              accountId,
              credit: amount,
              description: `Invoice ${created.number}`,
            })),
            ...(taxTotal.gt(0)
              ? [
                  {
                    accountId: taxPayable.id,
                    credit: taxTotal,
                    description: `Sales tax on ${created.number}`,
                  },
                ]
              : []),
          ],
        });
        await prisma.invoice.update({
          where: { id: created.id },
          data: { status: InvoiceStatus.SENT, sentAt: new Date(`${invoice.issueDate}T12:00:00.000Z`) },
        });
      }
    }
    console.log(`Seeded ${INVOICES[name].length} invoices for ${name}`);
  }
  for (const name of ORGANIZATIONS) {
    const organizationId = orgs.get(name);
    if (!organizationId) throw new Error(`Missing organization ${name}`);
    const existing = await prisma.bill.count({ where: { organizationId } });
    if (existing > 0) continue;

    const [payable, purchaseTax] = await Promise.all([
      prisma.account.findFirstOrThrow({
        where: { organizationId, code: '2000', active: true },
      }),
      prisma.account.findFirstOrThrow({
        where: { organizationId, code: '1300', active: true },
      }),
    ]);

    for (const bill of BILLS[name]) {
      const vendor = await prisma.vendor.findFirstOrThrow({
        where: { organizationId, code: bill.vendorCode },
      });
      const lines = [];
      for (const [index, line] of bill.lines.entries()) {
        const expense = await prisma.account.findFirstOrThrow({
          where: { organizationId, code: line.expenseCode },
        });
        const quantity = new Prisma.Decimal(line.quantity);
        const unitPrice = new Prisma.Decimal(line.unitPrice);
        lines.push({
          organizationId,
          position: index,
          description: line.description,
          quantity,
          unitPrice,
          amount: quantity.mul(unitPrice).toDecimalPlaces(2),
          expenseAccountId: expense.id,
        });
      }

      const subtotal = lines.reduce(
        (sum, line) => sum.plus(line.amount),
        new Prisma.Decimal(0),
      );
      const taxRate = new Prisma.Decimal(bill.taxRate);
      const taxTotal = subtotal.mul(taxRate).toDecimalPlaces(2);
      const total = subtotal.plus(taxTotal);

      const created = await prisma.bill.create({
        data: {
          organizationId,
          number: bill.number,
          vendorId: vendor.id,
          status: BillStatus.DRAFT,
          issueDate: new Date(`${bill.issueDate}T00:00:00.000Z`),
          dueDate: new Date(`${bill.dueDate}T00:00:00.000Z`),
          taxRate,
          subtotal,
          taxTotal,
          total,
          notes: bill.notes,
          lines: { create: lines },
        },
      });

      if (bill.status !== BillStatus.DRAFT) {
        const expenseByAccount = new Map<string, Prisma.Decimal>();
        for (const line of lines) {
          expenseByAccount.set(
            line.expenseAccountId,
            (expenseByAccount.get(line.expenseAccountId) ?? new Prisma.Decimal(0)).plus(
              line.amount,
            ),
          );
        }
        await postEntry(prisma, organizationId, {
          date: bill.issueDate,
          memo: `Bill ${created.number} — ${vendor.name}`,
          sourceType: JournalSourceType.BILL,
          sourceId: created.id,
          lines: [
            ...[...expenseByAccount.entries()].map(([accountId, amount]) => ({
              accountId,
              debit: amount,
              description: `Bill ${created.number}`,
            })),
            ...(taxTotal.gt(0)
              ? [
                  {
                    accountId: purchaseTax.id,
                    debit: taxTotal,
                    description: `Purchase tax on ${created.number}`,
                  },
                ]
              : []),
            {
              accountId: payable.id,
              credit: total,
              description: `Bill ${created.number}`,
            },
          ],
        });
        await prisma.bill.update({
          where: { id: created.id },
          data: { status: BillStatus.OPEN, openedAt: new Date(`${bill.issueDate}T12:00:00.000Z`) },
        });
      }
    }
    console.log(`Seeded ${BILLS[name].length} bills for ${name}`);
  }
  for (const name of ORGANIZATIONS) {
    const organizationId = orgs.get(name);
    if (!organizationId) throw new Error(`Missing organization ${name}`);
    const existing = await prisma.estimate.count({ where: { organizationId } });
    if (existing > 0) continue;

    for (const estimate of ESTIMATES[name]) {
      const customer = await prisma.customer.findFirstOrThrow({
        where: { organizationId, code: estimate.customerCode },
      });
      const lines = [];
      for (const [index, line] of estimate.lines.entries()) {
        const item = await prisma.item.findFirstOrThrow({
          where: { organizationId, code: line.itemCode },
        });
        const quantity = new Prisma.Decimal(line.quantity);
        const unitPrice = new Prisma.Decimal(line.unitPrice ?? item.price);
        lines.push({
          organizationId,
          position: index,
          itemId: item.id,
          description: line.description ?? item.name,
          quantity,
          unitPrice,
          amount: quantity.mul(unitPrice).toDecimalPlaces(2),
          taxable: item.taxable,
          incomeAccountId: item.incomeAccountId,
        });
      }
      const subtotal = lines.reduce(
        (sum, line) => sum.plus(line.amount),
        new Prisma.Decimal(0),
      );
      const taxable = lines.reduce(
        (sum, line) => (line.taxable ? sum.plus(line.amount) : sum),
        new Prisma.Decimal(0),
      );
      const taxRate = new Prisma.Decimal(estimate.taxRate);
      const taxTotal = taxable.mul(taxRate).toDecimalPlaces(2);

      await prisma.estimate.create({
        data: {
          organizationId,
          number: estimate.number,
          customerId: customer.id,
          status: estimate.status,
          issueDate: new Date(`${estimate.issueDate}T00:00:00.000Z`),
          expiryDate: new Date(`${estimate.expiryDate}T00:00:00.000Z`),
          taxRate,
          subtotal,
          taxTotal,
          total: subtotal.plus(taxTotal),
          notes: estimate.notes,
          lines: { create: lines },
        },
      });
    }
    console.log(`Seeded ${ESTIMATES[name].length} estimates for ${name}`);
  }

  const engine = new BankingImportEngine();
  for (const name of ORGANIZATIONS) {
    const organizationId = orgs.get(name);
    if (!organizationId) throw new Error(`Missing organization ${name}`);

    const [cash, checking, receivable] = await Promise.all([
      prisma.account.findFirstOrThrow({ where: { organizationId, code: '1000' } }),
      prisma.account.findFirstOrThrow({ where: { organizationId, code: '1020' } }),
      prisma.account.findFirstOrThrow({
        where: { organizationId, code: '1100', active: true },
      }),
    ]);

    let bankAccount = await prisma.bankAccount.findFirst({
      where: { organizationId, ledgerAccountId: checking.id },
    });
    if (!bankAccount) {
      bankAccount = await prisma.bankAccount.create({
        data: {
          organizationId,
          name: DEMO_BANK_ACCOUNT_NAME,
          type: BankAccountType.CHECKING,
          ledgerAccountId: checking.id,
        },
      });
    }

    const existingTransfer = await prisma.journalEntry.findFirst({
      where: { organizationId, memo: DEMO_TRANSFER_MEMO },
    });
    if (!existingTransfer) {
      await postEntry(prisma, organizationId, {
        date: DEMO_TRANSFER_DATE,
        memo: DEMO_TRANSFER_MEMO,
        lines: [
          {
            accountId: checking.id,
            debit: DEMO_TRANSFER_AMOUNT,
            description: 'Move cash to checking',
          },
          {
            accountId: cash.id,
            credit: DEMO_TRANSFER_AMOUNT,
            description: 'Move cash to checking',
          },
        ],
      });
      console.log(`Seeded checking transfer for ${name}`);
    }

    const filename = BANK_CSV_FILES[name];
    const buffer = readFileSync(join(__dirname, 'seed-data', filename));
    const analysis = engine.analyze({ filename: DEMO_BATCH_FILENAME, buffer });
    if (analysis.mappingError) {
      throw new Error(`Seed bank CSV ${filename}: ${analysis.mappingError}`);
    }
    const rows = analysis.rows.filter((row) => row.valid);
    if (rows.length === 0) {
      throw new Error(`Seed bank CSV ${filename} has no valid rows`);
    }

    let batch = await prisma.bankImportBatch.findFirst({
      where: {
        organizationId,
        bankAccountId: bankAccount.id,
        filename: DEMO_BATCH_FILENAME,
      },
    });
    if (!batch) {
      batch = await prisma.bankImportBatch.create({
        data: {
          organizationId,
          bankAccountId: bankAccount.id,
          filename: DEMO_BATCH_FILENAME,
          format: BankImportFormat.CSV,
          rowCount: analysis.counts.total,
          importedCount: rows.length,
          duplicateCount: 0,
          invalidCount: analysis.counts.invalid,
        },
      });
    }

    const seededTransactionIds: string[] = [];
    for (const row of rows) {
      if (!row.date || row.amount === null || !row.fingerprint) continue;
      const date = utcDate(row.date);
      const amount = new Prisma.Decimal(row.amount.toFixed(2));
      const shared = {
        importBatchId: batch.id,
        date,
        description: row.description,
        amount,
        externalId: row.externalId,
        categoryAccountId: receivable.id,
        categoryRuleId: null,
        matchState: BankTransactionMatchState.CATEGORIZED,
        raw: row.raw as Prisma.InputJsonValue,
      };
      const transaction = await prisma.bankTransaction.upsert({
        where: {
          organizationId_bankAccountId_fingerprint: {
            organizationId,
            bankAccountId: bankAccount.id,
            fingerprint: row.fingerprint,
          },
        },
        update: shared,
        create: {
          organizationId,
          bankAccountId: bankAccount.id,
          fingerprint: row.fingerprint,
          ...shared,
        },
      });
      seededTransactionIds.push(transaction.id);

      const existingEntry = await prisma.journalEntry.findFirst({
        where: {
          organizationId,
          sourceType: JournalSourceType.BANK,
          sourceId: transaction.id,
        },
      });
      if (!existingEntry) {
        const magnitude = amount.abs();
        const inflow = amount.gt(0);
        const description = `Bank import — ${row.description}`;
        await postEntry(prisma, organizationId, {
          date: DEMO_BANK_DATE,
          memo: description,
          sourceType: JournalSourceType.BANK,
          sourceId: transaction.id,
          lines: inflow
            ? [
                { accountId: checking.id, debit: magnitude, description },
                { accountId: receivable.id, credit: magnitude, description },
              ]
            : [
                { accountId: receivable.id, debit: magnitude, description },
                { accountId: checking.id, credit: magnitude, description },
              ],
        });
      }
    }

    const periodStart = utcDate(DEMO_RECON_PERIOD_START);
    const periodEnd = utcDate(DEMO_RECON_PERIOD_END);
    let session = await prisma.reconciliationSession.findFirst({
      where: {
        organizationId,
        bankAccountId: bankAccount.id,
        periodStart,
        periodEnd,
      },
    });
    if (!session) {
      const ownerEmail = OWNER_EMAILS[name];
      const ownerId = userIds.get(ownerEmail);
      if (!ownerId) throw new Error(`Missing seed owner ${ownerEmail}`);
      const completedAt = new Date(DEMO_RECON_COMPLETED_AT);
      session = await prisma.reconciliationSession.create({
        data: {
          organizationId,
          bankAccountId: bankAccount.id,
          periodStart,
          periodEnd,
          statementEndingBalance: new Prisma.Decimal('500.00'),
          openingBalance: new Prisma.Decimal('500.00'),
          clearedTotal: new Prisma.Decimal('0.00'),
          bookBalance: new Prisma.Decimal('500.00'),
          difference: new Prisma.Decimal('0.00'),
          status: ReconciliationStatus.COMPLETED,
          completedAt,
          completedById: ownerId,
          completionSnapshot: {
            statementEndingBalance: 500,
            openingBalance: 500,
            clearedTotal: 0,
            clearedBalance: 500,
            bookBalance: 500,
            difference: 0,
            clearedCount: rows.length,
            transactionCount: rows.length,
            completedAt: completedAt.toISOString(),
          },
        },
      });
      console.log(`Seeded completed reconciliation for ${name}`);
    }

    await prisma.bankTransaction.updateMany({
      where: { organizationId, id: { in: seededTransactionIds } },
      data: {
        reconciliationSessionId: session.id,
        clearedAt: new Date(DEMO_RECON_CLEARED_AT),
      },
    });

    const ownerEmail = OWNER_EMAILS[name];
    const ownerId = userIds.get(ownerEmail);
    if (!ownerId) throw new Error(`Missing seed owner ${ownerEmail}`);
    let automation = await prisma.agentAutomation.findUnique({
      where: { organizationId_name: { organizationId, name: DEMO_AUTOMATION_NAME } },
    });
    if (!automation) {
      automation = await prisma.agentAutomation.create({
        data: {
          organizationId,
          name: DEMO_AUTOMATION_NAME,
          mode: AgentAutomationMode.CRON,
          cron: DEMO_AUTOMATION_CRON,
          timezone: DEMO_AUTOMATION_TIMEZONE,
          prompt: DEMO_AUTOMATION_PROMPT,
          enabled: true,
          createdByUserId: ownerId,
        },
      });
      console.log(`Seeded automation for ${name}`);
    }
    await registerAutomationSchedule(automation.id, organizationId);
  }

}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
