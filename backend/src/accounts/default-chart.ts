import { AccountType, PrismaClient } from '@prisma/client';

export interface DefaultAccount {
  code: string;
  name: string;
  type: AccountType;
  subtype: string;
}

export const DEFAULT_CHART: readonly DefaultAccount[] = [
  { code: '1000', name: 'Cash', type: 'ASSET', subtype: 'Current asset' },
  { code: '1020', name: 'Checking account', type: 'ASSET', subtype: 'Current asset' },
  { code: '1100', name: 'Accounts receivable', type: 'ASSET', subtype: 'Accounts receivable' },
  { code: '1200', name: 'Prepaid expenses', type: 'ASSET', subtype: 'Current asset' },
  { code: '1300', name: 'Purchase tax receivable', type: 'ASSET', subtype: 'Current asset' },
  { code: '1500', name: 'Equipment', type: 'ASSET', subtype: 'Fixed asset' },
  { code: '2000', name: 'Accounts payable', type: 'LIABILITY', subtype: 'Accounts payable' },
  { code: '2100', name: 'Sales tax payable', type: 'LIABILITY', subtype: 'Current liability' },
  { code: '2200', name: 'Accrued liabilities', type: 'LIABILITY', subtype: 'Current liability' },
  { code: '3000', name: 'Owner equity', type: 'EQUITY', subtype: 'Equity' },
  { code: '3100', name: 'Retained earnings', type: 'EQUITY', subtype: 'Equity' },
  { code: '4000', name: 'Sales income', type: 'INCOME', subtype: 'Income' },
  { code: '4100', name: 'Other income', type: 'INCOME', subtype: 'Other income' },
  { code: '6000', name: 'Rent expense', type: 'EXPENSE', subtype: 'Operating expense' },
  { code: '6100', name: 'Utilities expense', type: 'EXPENSE', subtype: 'Operating expense' },
  { code: '6200', name: 'Supplies expense', type: 'EXPENSE', subtype: 'Operating expense' },
  { code: '6300', name: 'Professional fees', type: 'EXPENSE', subtype: 'Operating expense' },
  { code: '6400', name: 'Bank fees', type: 'EXPENSE', subtype: 'Operating expense' },
  { code: '6900', name: 'General expense', type: 'EXPENSE', subtype: 'General expense' },
];

/**
 * Idempotently gives an organization the industry-neutral starting chart.
 * Existing codes (including deactivated ones) are never overwritten.
 */
export async function ensureDefaultChart(
  prisma: PrismaClient,
  organizationId: string,
): Promise<void> {
  await prisma.account.createMany({
    data: DEFAULT_CHART.map((account) => ({ ...account, organizationId })),
    skipDuplicates: true,
  });
}
