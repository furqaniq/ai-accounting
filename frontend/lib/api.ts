export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

export const TOKEN_KEY = 'daybook.accessToken';
export const REFRESH_TOKEN_KEY = 'daybook.refreshToken';
export const ACTIVE_ORG_KEY = 'daybook.activeOrgId';

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function getActiveOrgId(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(ACTIVE_ORG_KEY);
}

export function setActiveOrgId(organizationId: string | null): void {
  if (organizationId) {
    window.localStorage.setItem(ACTIVE_ORG_KEY, organizationId);
  } else {
    window.localStorage.removeItem(ACTIVE_ORG_KEY);
  }
}

export function clearSession(): void {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  window.localStorage.removeItem(ACTIVE_ORG_KEY);
}

export function saveSession(accessToken: string, refreshToken: string): void {
  window.localStorage.setItem(TOKEN_KEY, accessToken);
  window.localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

export function authHeaders(organizationId?: string | null): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (organizationId) headers['X-Organization-Id'] = organizationId;
  return headers;
}

export interface Membership {
  organizationId: string;
  organizationName: string;
  role: string;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  memberships: Membership[];
}

export interface ActiveOrganization {
  organizationId: string;
  organizationName: string;
  role: string;
}

export interface Member {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
}

export async function fetchActiveOrganization(
  organizationId: string,
): Promise<ActiveOrganization> {
  const res = await fetch(`${API_URL}/organizations/active`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error('Organization not accessible');
  return res.json();
}

export async function fetchMembers(organizationId: string): Promise<Member[]> {
  const res = await fetch(`${API_URL}/memberships`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error('Members not available');
  const body = (await res.json()) as { memberships: Member[] };
  return body.memberships;
}

export const ROLES = ['OWNER', 'ADMIN', 'ACCOUNTANT', 'STAFF', 'VIEWER'] as const;

export type RoleName = (typeof ROLES)[number];

async function failureMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string | string[] };
    const message = Array.isArray(body.message) ? body.message[0] : body.message;
    if (message) return message;
  } catch {
    // fall through
  }
  return fallback;
}

export async function createMember(
  organizationId: string,
  email: string,
  role: string,
): Promise<Member> {
  const res = await fetch(`${API_URL}/memberships`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify({ email, role }),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not add that member'));
  return res.json();
}

export async function updateMemberRole(
  organizationId: string,
  membershipId: string,
  role: string,
): Promise<Member> {
  const res = await fetch(`${API_URL}/memberships/${membershipId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify({ role }),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not change that role'));
  return res.json();
}

export async function removeMember(
  organizationId: string,
  membershipId: string,
): Promise<void> {
  const res = await fetch(`${API_URL}/memberships/${membershipId}`, {
    method: 'DELETE',
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not remove that member'));
}

export function canManageMembers(role: string): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

export interface OrgSettings {
  organizationId: string;
  name: string;
  fiscalYearStartMonth: number;
  fiscalYearStartDay: number;
  baseCurrency: string;
  defaultTaxRate: number;
  updatedAt: string;
}

export interface OrgSettingsPatch {
  name?: string;
  fiscalYearStartMonth?: number;
  fiscalYearStartDay?: number;
  baseCurrency?: string;
  defaultTaxRate?: number;
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: { changes?: Record<string, { from: unknown; to: unknown }>; [key: string]: unknown } | null;
  createdAt: string;
  actor: { id: string; name: string; email: string };
}

export async function fetchSettings(organizationId: string): Promise<OrgSettings> {
  const res = await fetch(`${API_URL}/organizations/settings`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error('Settings are not available');
  return res.json();
}

export async function saveSettings(
  organizationId: string,
  patch: OrgSettingsPatch,
): Promise<OrgSettings> {
  const res = await fetch(`${API_URL}/organizations/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not save those settings'));
  return res.json();
}

export async function fetchAuditLog(
  organizationId: string,
  filters: { action?: string; entityType?: string; limit?: number } = {},
): Promise<AuditEntry[]> {
  const params = new URLSearchParams();
  if (filters.action) params.set('action', filters.action);
  if (filters.entityType) params.set('entityType', filters.entityType);
  if (filters.limit) params.set('limit', String(filters.limit));
  const query = params.toString();
  const res = await fetch(`${API_URL}/audit-log${query ? `?${query}` : ''}`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error('The audit log is not available');
  const body = (await res.json()) as { entries: AuditEntry[] };
  return body.entries;
}

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';

export interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  subtype: string | null;
  active: boolean;
}

export interface AccountInput {
  code: string;
  name: string;
  type: string;
  subtype?: string;
  active?: boolean;
}

export async function fetchAccounts(organizationId: string): Promise<Account[]> {
  const res = await fetch(`${API_URL}/accounts`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error('Accounts are not available');
  const body = (await res.json()) as { accounts: Account[] };
  return body.accounts;
}

export async function createAccount(
  organizationId: string,
  input: AccountInput,
): Promise<Account> {
  const res = await fetch(`${API_URL}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not add that account'));
  return res.json();
}

export async function updateAccount(
  organizationId: string,
  accountId: string,
  input: Partial<AccountInput>,
): Promise<Account> {
  const res = await fetch(`${API_URL}/accounts/${accountId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not save that account'));
  return res.json();
}

export type JournalSourceType =
  | 'MANUAL'
  | 'INVOICE'
  | 'BILL'
  | 'EXPENSE'
  | 'PAYMENT'
  | 'BANK'
  | 'REVERSAL';

export interface JournalLine {
  id: string;
  accountId: string;
  account: { id: string; code: string; name: string; type: AccountType };
  description: string | null;
  debit: number;
  credit: number;
}

export interface JournalEntry {
  id: string;
  reference: string;
  date: string;
  memo: string | null;
  sourceType: JournalSourceType;
  sourceId: string | null;
  reversalOfId: string | null;
  reversalOfReference: string | null;
  reversedById: string | null;
  reversedByReference: string | null;
  createdAt: string;
  lines: JournalLine[];
}

export interface JournalLineInput {
  accountId: string;
  description?: string;
  debit?: number;
  credit?: number;
}

export interface JournalEntryInput {
  date: string;
  memo?: string;
  lines: JournalLineInput[];
}

export interface RegisterLine {
  id: string;
  entryId: string;
  reference: string;
  date: string;
  memo: string | null;
  description: string | null;
  sourceType: JournalSourceType;
  debit: number;
  credit: number;
  runningBalance: number;
}

export interface AccountRegister {
  account: { id: string; code: string; name: string; type: AccountType };
  from: string | null;
  to: string | null;
  openingBalance: number;
  closingBalance: number;
  totalDebit: number;
  totalCredit: number;
  lines: RegisterLine[];
}

export async function fetchJournalEntries(
  organizationId: string,
  filters: { from?: string; to?: string; accountId?: string; limit?: number } = {},
): Promise<JournalEntry[]> {
  const params = new URLSearchParams();
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.accountId) params.set('accountId', filters.accountId);
  if (filters.limit) params.set('limit', String(filters.limit));
  const query = params.toString();
  const res = await fetch(`${API_URL}/journal-entries${query ? `?${query}` : ''}`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error('Journal entries are not available');
  const body = (await res.json()) as { entries: JournalEntry[] };
  return body.entries;
}

export async function fetchJournalEntry(
  organizationId: string,
  entryId: string,
): Promise<JournalEntry> {
  const res = await fetch(`${API_URL}/journal-entries/${entryId}`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error('That journal entry is not available');
  return res.json();
}

export async function createJournalEntry(
  organizationId: string,
  input: JournalEntryInput,
): Promise<JournalEntry> {
  const res = await fetch(`${API_URL}/journal-entries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not post that entry'));
  return res.json();
}

export async function reverseJournalEntry(
  organizationId: string,
  entryId: string,
  input: { date?: string; memo?: string } = {},
): Promise<JournalEntry> {
  const res = await fetch(`${API_URL}/journal-entries/${entryId}/reverse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not reverse that entry'));
  return res.json();
}

export async function fetchRegister(
  organizationId: string,
  accountId: string,
  filters: { from?: string; to?: string } = {},
): Promise<AccountRegister> {
  const params = new URLSearchParams({ accountId });
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  const res = await fetch(`${API_URL}/ledger/register?${params.toString()}`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error('That register is not available');
  return res.json();
}

export interface Customer {
  id: string;
  code: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  notes: string | null;
  active: boolean;
  balance: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerInput {
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  notes?: string;
  active?: boolean;
}

export async function fetchCustomers(
  organizationId: string,
  filters: { search?: string; active?: boolean } = {},
): Promise<Customer[]> {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.active !== undefined) params.set('active', String(filters.active));
  const query = params.toString();
  const res = await fetch(`${API_URL}/customers${query ? `?${query}` : ''}`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error('Customers are not available');
  const body = (await res.json()) as { customers: Customer[] };
  return body.customers;
}

export async function fetchCustomer(
  organizationId: string,
  customerId: string,
): Promise<Customer> {
  const res = await fetch(`${API_URL}/customers/${customerId}`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error('That customer is not available');
  return res.json();
}

export async function createCustomer(
  organizationId: string,
  input: CustomerInput,
): Promise<Customer> {
  const res = await fetch(`${API_URL}/customers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not add that customer'));
  return res.json();
}

export async function updateCustomer(
  organizationId: string,
  customerId: string,
  input: Partial<CustomerInput>,
): Promise<Customer> {
  const res = await fetch(`${API_URL}/customers/${customerId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not save that customer'));
  return res.json();
}

export interface Item {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price: number;
  incomeAccountId: string;
  incomeAccount: { id: string; code: string; name: string };
  taxable: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ItemInput {
  name: string;
  description?: string;
  price: number;
  incomeAccountId: string;
  taxable?: boolean;
  active?: boolean;
}

export async function fetchItems(
  organizationId: string,
  filters: { search?: string; active?: boolean } = {},
): Promise<Item[]> {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.active !== undefined) params.set('active', String(filters.active));
  const query = params.toString();
  const res = await fetch(`${API_URL}/items${query ? `?${query}` : ''}`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error('Items are not available');
  const body = (await res.json()) as { items: Item[] };
  return body.items;
}

export async function createItem(organizationId: string, input: ItemInput): Promise<Item> {
  const res = await fetch(`${API_URL}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not add that item'));
  return res.json();
}

export async function updateItem(
  organizationId: string,
  itemId: string,
  input: Partial<ItemInput>,
): Promise<Item> {
  const res = await fetch(`${API_URL}/items/${itemId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not save that item'));
  return res.json();
}
