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

export interface Vendor {
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

export interface VendorInput {
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

export async function fetchVendors(
  organizationId: string,
  filters: { search?: string; active?: boolean } = {},
): Promise<Vendor[]> {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.active !== undefined) params.set('active', String(filters.active));
  const query = params.toString();
  const res = await fetch(`${API_URL}/vendors${query ? `?${query}` : ''}`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error('Vendors are not available');
  const body = (await res.json()) as { vendors: Vendor[] };
  return body.vendors;
}

export async function fetchVendor(
  organizationId: string,
  vendorId: string,
): Promise<Vendor> {
  const res = await fetch(`${API_URL}/vendors/${vendorId}`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error('That vendor is not available');
  return res.json();
}

export async function createVendor(
  organizationId: string,
  input: VendorInput,
): Promise<Vendor> {
  const res = await fetch(`${API_URL}/vendors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not add that vendor'));
  return res.json();
}

export async function updateVendor(
  organizationId: string,
  vendorId: string,
  input: Partial<VendorInput>,
): Promise<Vendor> {
  const res = await fetch(`${API_URL}/vendors/${vendorId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not save that vendor'));
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

export interface ProjectProfitability {
  revenue: number;
  expenses: number;
  profit: number;
  margin: number | null;
  totalHours: number;
  billableHours: number;
  invoicedHours: number;
  unbilledHours: number;
  nonBillableHours: number;
  billableValue: number;
  invoicedValue: number;
  unbilledValue: number;
  nonBillableValue: number;
  invoiceCount: number;
  expenseCount: number;
  timeEntryCount: number;
}

export interface Project {
  id: string;
  code: string;
  name: string;
  description: string | null;
  customerId: string | null;
  customer: { id: string; code: string; name: string } | null;
  billingItemId: string | null;
  billingItem: { id: string; code: string; name: string } | null;
  defaultRate: number | null;
  active: boolean;
  profitability: ProjectProfitability;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectInput {
  name: string;
  description?: string;
  customerId?: string;
  billingItemId?: string;
  defaultRate?: number | null;
  active?: boolean;
}

export interface ProjectInvoiceSource {
  id: string;
  number: string;
  status: InvoiceStatus;
  issueDate: string;
  dueDate: string;
  subtotal: number;
  total: number;
}

export interface ProjectExpenseSource {
  id: string;
  number: string;
  date: string;
  amount: number;
  categoryAccount: { id: string; code: string; name: string };
}

export interface TimeEntryInvoiceLink {
  id: string;
  number: string;
  status: InvoiceStatus;
  lineId: string;
}

export interface TimeEntry {
  id: string;
  date: string;
  projectId: string | null;
  project: { id: string; code: string; name: string } | null;
  userId: string;
  user: { id: string; name: string; email: string };
  hours: number;
  rate: number;
  amount: number;
  billable: boolean;
  notes: string | null;
  invoice: TimeEntryInvoiceLink | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDetail {
  project: Project;
  invoices: ProjectInvoiceSource[];
  expenses: ProjectExpenseSource[];
  timeEntries: TimeEntry[];
}

export interface TimeEntryInput {
  date?: string;
  hours: number;
  rate?: number;
  billable?: boolean;
  projectId?: string;
  notes?: string;
}

export interface RollupTimeInput {
  entryIds: string[];
  customerId?: string;
  billingItemId?: string;
  issueDate?: string;
  dueDate?: string;
  taxRate?: number;
  notes?: string;
}

export async function fetchProjects(
  organizationId: string,
  filters: { search?: string; active?: boolean; customerId?: string } = {},
): Promise<Project[]> {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.active !== undefined) params.set('active', String(filters.active));
  if (filters.customerId) params.set('customerId', filters.customerId);
  const query = params.toString();
  const res = await fetch(`${API_URL}/projects${query ? `?${query}` : ''}`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error('Projects are not available');
  const body = (await res.json()) as { projects: Project[] };
  return body.projects;
}

export async function fetchProject(
  organizationId: string,
  projectId: string,
): Promise<ProjectDetail> {
  const res = await fetch(`${API_URL}/projects/${projectId}`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error('That project is not available');
  return res.json();
}

export async function createProject(
  organizationId: string,
  input: ProjectInput,
): Promise<Project> {
  const res = await fetch(`${API_URL}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not add that project'));
  return res.json();
}

export async function updateProject(
  organizationId: string,
  projectId: string,
  input: Partial<ProjectInput>,
): Promise<Project> {
  const res = await fetch(`${API_URL}/projects/${projectId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not save that project'));
  return res.json();
}

export async function fetchTimeEntries(
  organizationId: string,
  filters: {
    projectId?: string;
    from?: string;
    to?: string;
    billable?: boolean;
    invoiced?: boolean;
  } = {},
): Promise<TimeEntry[]> {
  const params = new URLSearchParams();
  if (filters.projectId) params.set('projectId', filters.projectId);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.billable !== undefined) params.set('billable', String(filters.billable));
  if (filters.invoiced !== undefined) params.set('invoiced', String(filters.invoiced));
  const query = params.toString();
  const res = await fetch(`${API_URL}/time-entries${query ? `?${query}` : ''}`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error('Time entries are not available');
  const body = (await res.json()) as { timeEntries: TimeEntry[] };
  return body.timeEntries;
}

export async function createTimeEntry(
  organizationId: string,
  input: TimeEntryInput,
): Promise<TimeEntry> {
  const res = await fetch(`${API_URL}/time-entries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not save that time entry'));
  return res.json();
}

export async function updateTimeEntry(
  organizationId: string,
  timeEntryId: string,
  input: Partial<TimeEntryInput>,
): Promise<TimeEntry> {
  const res = await fetch(`${API_URL}/time-entries/${timeEntryId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not save that time entry'));
  return res.json();
}

export async function deleteTimeEntry(
  organizationId: string,
  timeEntryId: string,
): Promise<void> {
  const res = await fetch(`${API_URL}/time-entries/${timeEntryId}`, {
    method: 'DELETE',
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not remove that time entry'));
}

export async function rollupTimeEntries(
  organizationId: string,
  input: RollupTimeInput,
): Promise<{ invoice: Invoice; linkedEntryIds: string[] }> {
  const res = await fetch(`${API_URL}/time-entries/rollup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not bill that time'));
  return res.json();
}

export type InvoiceStatus = 'DRAFT' | 'SENT' | 'PARTIAL' | 'PAID' | 'OVERDUE';

export interface InvoiceCustomer {
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
}

export interface InvoiceLine {
  id: string;
  itemId: string;
  item: { id: string; code: string; name: string };
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  taxable: boolean;
  incomeAccountId: string;
  incomeAccount: { id: string; code: string; name: string };
  timeEntry: {
    id: string;
    date: string;
    hours: number;
    rate: number;
    amount: number;
    billable: boolean;
    notes: string | null;
    user: { id: string; name: string; email: string };
  } | null;
}

export interface Invoice {
  id: string;
  number: string;
  status: InvoiceStatus;
  customerId: string;
  customer: InvoiceCustomer;
  projectId: string | null;
  project: { id: string; code: string; name: string } | null;
  issueDate: string;
  dueDate: string;
  sentAt: string | null;
  paidAt: string | null;
  taxRate: number;
  subtotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  daysOverdue: number;
  notes: string | null;
  lines: InvoiceLine[];
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceLineInput {
  itemId: string;
  quantity: number;
  unitPrice?: number;
  description?: string;
}

export interface InvoiceInput {
  customerId: string;
  projectId?: string;
  issueDate?: string;
  dueDate: string;
  lines: InvoiceLineInput[];
  taxRate?: number;
  notes?: string;
}

export async function fetchInvoices(
  organizationId: string,
  filters: { status?: InvoiceStatus; customerId?: string; search?: string } = {},
): Promise<Invoice[]> {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.customerId) params.set('customerId', filters.customerId);
  if (filters.search) params.set('search', filters.search);
  const query = params.toString();
  const res = await fetch(`${API_URL}/invoices${query ? `?${query}` : ''}`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error('Invoices are not available');
  const body = (await res.json()) as { invoices: Invoice[] };
  return body.invoices;
}

export async function fetchInvoice(
  organizationId: string,
  invoiceId: string,
): Promise<Invoice> {
  const res = await fetch(`${API_URL}/invoices/${invoiceId}`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error('That invoice is not available');
  return res.json();
}

export async function createInvoice(
  organizationId: string,
  input: InvoiceInput,
): Promise<Invoice> {
  const res = await fetch(`${API_URL}/invoices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not create that invoice'));
  return res.json();
}

export async function updateInvoice(
  organizationId: string,
  invoiceId: string,
  input: Partial<InvoiceInput>,
): Promise<Invoice> {
  const res = await fetch(`${API_URL}/invoices/${invoiceId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not save that invoice'));
  return res.json();
}

export async function sendInvoice(
  organizationId: string,
  invoiceId: string,
): Promise<Invoice> {
  const res = await fetch(`${API_URL}/invoices/${invoiceId}/send`, {
    method: 'POST',
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not send that invoice'));
  return res.json();
}

export type EstimateStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'DECLINED';

export interface EstimateLine {
  id: string;
  itemId: string;
  item: { id: string; code: string; name: string };
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  taxable: boolean;
  incomeAccountId: string;
  incomeAccount: { id: string; code: string; name: string };
}

export interface Estimate {
  id: string;
  number: string;
  status: EstimateStatus;
  customerId: string;
  customer: InvoiceCustomer;
  projectId: string | null;
  project: { id: string; code: string; name: string } | null;
  issueDate: string;
  expiryDate: string | null;
  taxRate: number;
  subtotal: number;
  taxTotal: number;
  total: number;
  notes: string | null;
  convertedInvoice: { id: string; number: string; status: string } | null;
  lines: EstimateLine[];
  createdAt: string;
  updatedAt: string;
}

export interface EstimateInput {
  customerId: string;
  issueDate?: string;
  expiryDate?: string;
  lines: InvoiceLineInput[];
  taxRate?: number;
  notes?: string;
}

export async function fetchEstimates(
  organizationId: string,
  filters: { status?: EstimateStatus; customerId?: string; search?: string } = {},
): Promise<Estimate[]> {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.customerId) params.set('customerId', filters.customerId);
  if (filters.search) params.set('search', filters.search);
  const query = params.toString();
  const res = await fetch(`${API_URL}/estimates${query ? `?${query}` : ''}`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error('Estimates are not available');
  const body = (await res.json()) as { estimates: Estimate[] };
  return body.estimates;
}

export async function fetchEstimate(
  organizationId: string,
  estimateId: string,
): Promise<Estimate> {
  const res = await fetch(`${API_URL}/estimates/${estimateId}`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error('That estimate is not available');
  return res.json();
}

export async function createEstimate(
  organizationId: string,
  input: EstimateInput,
): Promise<Estimate> {
  const res = await fetch(`${API_URL}/estimates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not create that estimate'));
  return res.json();
}

export async function updateEstimate(
  organizationId: string,
  estimateId: string,
  input: Partial<EstimateInput>,
): Promise<Estimate> {
  const res = await fetch(`${API_URL}/estimates/${estimateId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not save that estimate'));
  return res.json();
}

export async function updateEstimateStatus(
  organizationId: string,
  estimateId: string,
  status: Exclude<EstimateStatus, 'DRAFT'>,
): Promise<Estimate> {
  const res = await fetch(`${API_URL}/estimates/${estimateId}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not change that status'));
  return res.json();
}

export async function convertEstimate(
  organizationId: string,
  estimateId: string,
): Promise<Estimate> {
  const res = await fetch(`${API_URL}/estimates/${estimateId}/convert`, {
    method: 'POST',
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not convert that estimate'));
  return res.json();
}

export async function downloadInvoicePdf(
  organizationId: string,
  invoiceId: string,
): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(`${API_URL}/invoices/${invoiceId}/pdf`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not download that invoice'));
  const disposition = res.headers.get('content-disposition') ?? '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'invoice.pdf';
  return { blob: await res.blob(), filename };
}

export type AgingBucketKey = 'current' | '1-30' | '31-60' | '61-90' | '90+';

export interface AgingBucket {
  key: AgingBucketKey;
  label: string;
  amount: number;
  count: number;
}

export interface AgingCustomer {
  customerId: string;
  customerCode: string;
  customerName: string;
  current: number;
  days1To30: number;
  days31To60: number;
  days61To90: number;
  days90Plus: number;
  total: number;
}

export interface AgingInvoice {
  id: string;
  number: string;
  customerId: string;
  customerCode: string;
  customerName: string;
  issueDate: string;
  dueDate: string;
  daysOverdue: number;
  bucket: AgingBucketKey;
  balanceDue: number;
}

export interface ArAgingReport {
  asOf: string;
  buckets: AgingBucket[];
  customers: AgingCustomer[];
  invoices: AgingInvoice[];
  overdue: AgingInvoice[];
  total: number;
}

export async function fetchArAging(
  organizationId: string,
  asOf?: string,
): Promise<ArAgingReport> {
  const params = new URLSearchParams();
  if (asOf) params.set('asOf', asOf);
  const query = params.toString();
  const res = await fetch(`${API_URL}/reports/ar-aging${query ? `?${query}` : ''}`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'The aging report is not available'));
  return res.json();
}

export type ApAgingBucketKey = 'current' | '1-30' | '31-60' | '61-90' | '90+';

export interface ApAgingBucket {
  key: ApAgingBucketKey;
  label: string;
  amount: number;
  count: number;
}

export interface ApAgingVendor {
  vendorId: string;
  vendorCode: string;
  vendorName: string;
  current: number;
  days1To30: number;
  days31To60: number;
  days61To90: number;
  days90Plus: number;
  total: number;
}

export interface ApAgingBill {
  id: string;
  number: string;
  vendorId: string;
  vendorCode: string;
  vendorName: string;
  issueDate: string;
  dueDate: string;
  daysOverdue: number;
  bucket: ApAgingBucketKey;
  balanceDue: number;
}

export interface ApAgingReport {
  asOf: string;
  buckets: ApAgingBucket[];
  vendors: ApAgingVendor[];
  bills: ApAgingBill[];
  overdue: ApAgingBill[];
  total: number;
}

export async function fetchApAging(
  organizationId: string,
  asOf?: string,
): Promise<ApAgingReport> {
  const params = new URLSearchParams();
  if (asOf) params.set('asOf', asOf);
  const query = params.toString();
  const res = await fetch(`${API_URL}/reports/ap-aging${query ? `?${query}` : ''}`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'The aging report is not available'));
  return res.json();
}

export interface ReportAccountRow {
  accountId: string | null;
  code: string | null;
  name: string;
  amount: number;
  synthetic?: boolean;
}

export interface StatementGroup {
  key: string;
  label: string;
  accounts: ReportAccountRow[];
  total: number;
}

export interface ProfitLossReport {
  report: 'profit-loss';
  from: string;
  to: string;
  groups: StatementGroup[];
  totalIncome: number;
  totalExpenses: number;
  netIncome: number;
}

export interface BalanceSheetReport {
  report: 'balance-sheet';
  asOf: string;
  groups: StatementGroup[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  totalLiabilitiesAndEquity: number;
  currentEarnings: number;
  balanced: boolean;
}

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: string;
  debit: number;
  credit: number;
}

export interface TrialBalanceReport {
  report: 'trial-balance';
  asOf: string;
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
  debitsEqualCredits: boolean;
}

export type CashFlowClassification = 'operating' | 'investing' | 'financing';

export interface CashFlowLine {
  accountId: string;
  code: string;
  name: string;
  amount: number;
}

export interface CashFlowGroup {
  key: CashFlowClassification;
  label: string;
  lines: CashFlowLine[];
  total: number;
}

export interface CashFlowReport {
  report: 'cash-flow';
  from: string;
  to: string;
  cashAccounts: Array<{ id: string; code: string; name: string; type: string }>;
  beginningCash: number;
  netChange: number;
  endingCash: number;
  groups: CashFlowGroup[];
  reconciled: boolean;
}

function reportQuery(values: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

export interface SalesByCustomerSource {
  type: 'invoice';
  id: string;
  number: string;
  date: string;
  amount: number;
  tax: number;
  total: number;
  quantity: number;
}

export interface SalesByCustomerRow {
  customerId: string;
  code: string;
  name: string;
  amount: number;
  tax: number;
  total: number;
  quantity: number;
  count: number;
  sources: SalesByCustomerSource[];
}

export interface SalesByCustomerReport {
  report: 'sales-by-customer';
  from: string;
  to: string;
  rows: SalesByCustomerRow[];
  totals: { amount: number; tax: number; total: number; quantity: number; count: number };
  ledgerIncome: number;
  reconciled: boolean;
}

export interface SalesByItemSource {
  type: 'invoice';
  id: string;
  lineId: string;
  number: string;
  date: string;
  quantity: number;
  amount: number;
}

export interface SalesByItemRow {
  itemId: string;
  code: string;
  name: string;
  amount: number;
  quantity: number;
  count: number;
  sources: SalesByItemSource[];
}

export interface SalesByItemReport {
  report: 'sales-by-item';
  from: string;
  to: string;
  rows: SalesByItemRow[];
  totals: { amount: number; quantity: number; count: number };
  ledgerIncome: number;
  reconciled: boolean;
}

export interface ExpenseCategorySource {
  type: 'expense' | 'bill';
  id: string;
  number: string;
  date: string;
  amount: number;
  party: string | null;
  memo: string | null;
}

export interface ExpensesByCategoryRow {
  accountId: string;
  code: string;
  name: string;
  amount: number;
  count: number;
  sources: ExpenseCategorySource[];
}

export interface ExpensesByCategoryReport {
  report: 'expenses-by-category';
  from: string;
  to: string;
  rows: ExpensesByCategoryRow[];
  totals: { amount: number; count: number };
  ledgerExpenses: number;
  reconciled: boolean;
}

export async function fetchSalesByCustomer(
  organizationId: string,
  period: { from?: string; to?: string } = {},
): Promise<SalesByCustomerReport> {
  const res = await fetch(
    `${API_URL}/reports/sales-by-customer${reportQuery({ from: period.from, to: period.to })}`,
    { headers: authHeaders(organizationId) },
  );
  if (!res.ok) throw new Error(await failureMessage(res, 'Sales by customer is not available'));
  return res.json();
}

export async function fetchSalesByItem(
  organizationId: string,
  period: { from?: string; to?: string } = {},
): Promise<SalesByItemReport> {
  const res = await fetch(
    `${API_URL}/reports/sales-by-item${reportQuery({ from: period.from, to: period.to })}`,
    { headers: authHeaders(organizationId) },
  );
  if (!res.ok) throw new Error(await failureMessage(res, 'Sales by item is not available'));
  return res.json();
}

export async function fetchExpensesByCategory(
  organizationId: string,
  period: { from?: string; to?: string } = {},
): Promise<ExpensesByCategoryReport> {
  const res = await fetch(
    `${API_URL}/reports/expenses-by-category${reportQuery({ from: period.from, to: period.to })}`,
    { headers: authHeaders(organizationId) },
  );
  if (!res.ok) throw new Error(await failureMessage(res, 'Expenses by category is not available'));
  return res.json();
}

export async function fetchProfitLoss(
  organizationId: string,
  period: { from?: string; to?: string } = {},
): Promise<ProfitLossReport> {
  const res = await fetch(
    `${API_URL}/reports/profit-loss${reportQuery({ from: period.from, to: period.to })}`,
    { headers: authHeaders(organizationId) },
  );
  if (!res.ok) throw new Error(await failureMessage(res, 'The profit and loss statement is not available'));
  return res.json();
}

export async function fetchBalanceSheet(
  organizationId: string,
  asOf?: string,
): Promise<BalanceSheetReport> {
  const res = await fetch(
    `${API_URL}/reports/balance-sheet${reportQuery({ asOf })}`,
    { headers: authHeaders(organizationId) },
  );
  if (!res.ok) throw new Error(await failureMessage(res, 'The balance sheet is not available'));
  return res.json();
}

export async function fetchCashFlow(
  organizationId: string,
  period: { from?: string; to?: string } = {},
): Promise<CashFlowReport> {
  const res = await fetch(
    `${API_URL}/reports/cash-flow${reportQuery({ from: period.from, to: period.to })}`,
    { headers: authHeaders(organizationId) },
  );
  if (!res.ok) throw new Error(await failureMessage(res, 'The cash flow statement is not available'));
  return res.json();
}

export async function fetchTrialBalance(
  organizationId: string,
  asOf?: string,
): Promise<TrialBalanceReport> {
  const res = await fetch(
    `${API_URL}/reports/trial-balance${reportQuery({ asOf })}`,
    { headers: authHeaders(organizationId) },
  );
  if (!res.ok) throw new Error(await failureMessage(res, 'The trial balance is not available'));
  return res.json();
}

export interface DashboardCashAccount {
  id: string;
  code: string;
  name: string;
  type: string;
  balance: number;
  netChange: number;
}

export interface DashboardTrendBucket {
  month: string;
  label: string;
  income: number;
  expenses: number;
  net: number;
}

export interface DashboardActivity {
  type: 'invoice' | 'bill' | 'expense' | 'payment' | 'bill-payment';
  id: string;
  number: string;
  party: string | null;
  date: string;
  amount: number;
  status: string;
  href: string;
}

export interface DashboardReport {
  from: string;
  to: string;
  cash: { total: number; accounts: DashboardCashAccount[] };
  receivables: { total: number; overdue: number; openCount: number };
  payables: { total: number; overdue: number; openCount: number };
  trend: {
    buckets: DashboardTrendBucket[];
    totalIncome: number;
    totalExpenses: number;
    netIncome: number;
  };
  recentActivity: DashboardActivity[];
  attention: {
    overdueInvoices: number;
    overdueBills: number;
    unmatchedBankTransactions: number;
  };
}

export async function fetchDashboard(
  organizationId: string,
  period: { from?: string; to?: string } = {},
): Promise<DashboardReport> {
  const res = await fetch(
    `${API_URL}/dashboard${reportQuery({ from: period.from, to: period.to })}`,
    { headers: authHeaders(organizationId) },
  );
  if (!res.ok) throw new Error(await failureMessage(res, 'The dashboard is not available'));
  return res.json();
}

export type ReportExportSlug =
  | 'profit-loss'
  | 'balance-sheet'
  | 'cash-flow'
  | 'trial-balance'
  | 'sales-by-customer'
  | 'sales-by-item'
  | 'expenses-by-category';

export type ReportExportFormat = 'csv' | 'pdf';

export interface ReportExportFilters {
  from?: string;
  to?: string;
  asOf?: string;
}

export async function downloadReportExport(
  organizationId: string,
  report: ReportExportSlug,
  filters: ReportExportFilters,
  format: ReportExportFormat,
): Promise<{ blob: Blob; filename: string }> {
  const params = new URLSearchParams({ format });
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.asOf) params.set('asOf', filters.asOf);
  const res = await fetch(`${API_URL}/reports/${report}/export?${params.toString()}`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not export that report'));
  const disposition = res.headers.get('content-disposition') ?? '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `${report}.${format}`;
  return { blob: await res.blob(), filename };
}

export type BillStatus = 'DRAFT' | 'OPEN' | 'PARTIAL' | 'PAID' | 'OVERDUE';

export interface BillLine {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  expenseAccountId: string;
  expenseAccount: { id: string; code: string; name: string; type: AccountType };
}

export interface Bill {
  id: string;
  number: string;
  status: BillStatus;
  vendorId: string;
  vendor: {
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
  };
  issueDate: string;
  dueDate: string;
  openedAt: string | null;
  paidAt: string | null;
  taxRate: number;
  subtotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  daysOverdue: number;
  notes: string | null;
  lines: BillLine[];
  createdAt: string;
  updatedAt: string;
}

export interface BillLineInput {
  description: string;
  quantity: number;
  unitPrice: number;
  expenseAccountId: string;
}

export interface BillInput {
  vendorId: string;
  issueDate?: string;
  dueDate: string;
  lines: BillLineInput[];
  taxRate?: number;
  notes?: string;
}

export async function fetchBills(
  organizationId: string,
  filters: { status?: BillStatus; vendorId?: string; search?: string } = {},
): Promise<Bill[]> {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.vendorId) params.set('vendorId', filters.vendorId);
  if (filters.search) params.set('search', filters.search);
  const query = params.toString();
  const res = await fetch(`${API_URL}/bills${query ? `?${query}` : ''}`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error('Bills are not available');
  const body = (await res.json()) as { bills: Bill[] };
  return body.bills;
}

export async function fetchBill(organizationId: string, billId: string): Promise<Bill> {
  const res = await fetch(`${API_URL}/bills/${billId}`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error('That bill is not available');
  return res.json();
}

export async function createBill(organizationId: string, input: BillInput): Promise<Bill> {
  const res = await fetch(`${API_URL}/bills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not create that bill'));
  return res.json();
}

export async function updateBill(
  organizationId: string,
  billId: string,
  input: Partial<BillInput>,
): Promise<Bill> {
  const res = await fetch(`${API_URL}/bills/${billId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not save that bill'));
  return res.json();
}

export async function openBill(organizationId: string, billId: string): Promise<Bill> {
  const res = await fetch(`${API_URL}/bills/${billId}/open`, {
    method: 'POST',
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not open that bill'));
  return res.json();
}

export interface BillPaymentApplication {
  id: string;
  billId: string;
  amount: number;
  bill: {
    id: string;
    number: string;
    status: BillStatus;
    total: number;
    amountPaid: number;
    balanceDue: number;
  };
}

export interface BillPayment {
  id: string;
  number: string;
  direction: 'SENT';
  vendorId: string;
  vendor: {
    id: string;
    code: string;
    name: string;
    email: string | null;
  };
  date: string;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  applications: BillPaymentApplication[];
  createdAt: string;
}

export interface BillPaymentInput {
  vendorId: string;
  date?: string;
  amount: number;
  method?: PaymentMethod;
  reference?: string;
  notes?: string;
  applications: Array<{ billId: string; amount: number }>;
}

export async function fetchBillPayments(
  organizationId: string,
  filters: { vendorId?: string; search?: string } = {},
): Promise<BillPayment[]> {
  const params = new URLSearchParams();
  if (filters.vendorId) params.set('vendorId', filters.vendorId);
  if (filters.search) params.set('search', filters.search);
  const query = params.toString();
  const res = await fetch(`${API_URL}/bill-payments${query ? `?${query}` : ''}`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error('Bill payments are not available');
  const body = (await res.json()) as { billPayments: BillPayment[] };
  return body.billPayments;
}

export async function fetchBillPayment(
  organizationId: string,
  billPaymentId: string,
): Promise<BillPayment> {
  const res = await fetch(`${API_URL}/bill-payments/${billPaymentId}`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error('That bill payment is not available');
  return res.json();
}

export async function createBillPayment(
  organizationId: string,
  input: BillPaymentInput,
): Promise<BillPayment> {
  const res = await fetch(`${API_URL}/bill-payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not record that bill payment'));
  return res.json();
}

export type PaymentMethod = 'CASH' | 'CHECK' | 'BANK_TRANSFER' | 'CARD' | 'OTHER';

export interface PaymentApplication {
  id: string;
  invoiceId: string;
  amount: number;
  invoice: {
    id: string;
    number: string;
    status: InvoiceStatus;
    total: number;
    amountPaid: number;
    balanceDue: number;
  };
}

export interface Payment {
  id: string;
  number: string;
  direction: 'RECEIVED' | 'SENT';
  customerId: string;
  customer: {
    id: string;
    code: string;
    name: string;
    email: string | null;
  };
  date: string;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  applications: PaymentApplication[];
  createdAt: string;
}

export interface PaymentInput {
  customerId: string;
  date?: string;
  amount: number;
  method?: PaymentMethod;
  reference?: string;
  notes?: string;
  applications: Array<{ invoiceId: string; amount: number }>;
}

export async function fetchPayments(
  organizationId: string,
  filters: { customerId?: string; search?: string } = {},
): Promise<Payment[]> {
  const params = new URLSearchParams();
  if (filters.customerId) params.set('customerId', filters.customerId);
  if (filters.search) params.set('search', filters.search);
  const query = params.toString();
  const res = await fetch(`${API_URL}/payments${query ? `?${query}` : ''}`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error('Payments are not available');
  const body = (await res.json()) as { payments: Payment[] };
  return body.payments;
}

export async function fetchPayment(
  organizationId: string,
  paymentId: string,
): Promise<Payment> {
  const res = await fetch(`${API_URL}/payments/${paymentId}`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error('That payment is not available');
  return res.json();
}

export async function createPayment(
  organizationId: string,
  input: PaymentInput,
): Promise<Payment> {
  const res = await fetch(`${API_URL}/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not record that payment'));
  return res.json();
}

export interface Expense {
  id: string;
  number: string;
  date: string;
  vendorId: string | null;
  vendor: { id: string; code: string; name: string } | null;
  projectId: string | null;
  project: { id: string; code: string; name: string } | null;
  categoryAccountId: string;
  categoryAccount: {
    id: string;
    code: string;
    name: string;
    type: AccountType;
  };
  amount: number;
  memo: string | null;
  receiptNote: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseInput {
  date?: string;
  vendorId?: string;
  projectId?: string;
  categoryAccountId: string;
  amount: number;
  memo?: string;
  receiptNote?: string;
}

export interface ExpenseFilters {
  from?: string;
  to?: string;
  vendorId?: string;
  projectId?: string;
  categoryAccountId?: string;
  search?: string;
}

export async function fetchExpenses(
  organizationId: string,
  filters: ExpenseFilters = {},
): Promise<Expense[]> {
  const params = new URLSearchParams();
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.vendorId) params.set('vendorId', filters.vendorId);
  if (filters.projectId) params.set('projectId', filters.projectId);
  if (filters.categoryAccountId) params.set('categoryAccountId', filters.categoryAccountId);
  if (filters.search) params.set('search', filters.search);
  const query = params.toString();
  const res = await fetch(`${API_URL}/expenses${query ? `?${query}` : ''}`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error('Expenses are not available');
  const body = (await res.json()) as { expenses: Expense[] };
  return body.expenses;
}

export async function fetchExpense(
  organizationId: string,
  expenseId: string,
): Promise<Expense> {
  const res = await fetch(`${API_URL}/expenses/${expenseId}`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error('That expense is not available');
  return res.json();
}

export async function createExpense(
  organizationId: string,
  input: ExpenseInput,
): Promise<Expense> {
  const res = await fetch(`${API_URL}/expenses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not record that expense'));
  return res.json();
}

export async function updateExpense(
  organizationId: string,
  expenseId: string,
  input: Partial<ExpenseInput>,
): Promise<Expense> {
  const res = await fetch(`${API_URL}/expenses/${expenseId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not save that expense'));
  return res.json();
}

export type AttachmentEntityType = 'EXPENSE' | 'BILL';

export interface Attachment {
  id: string;
  entityType: AttachmentEntityType;
  entityId: string;
  filename: string;
  contentType: string;
  size: number;
  createdAt: string;
}

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export async function fetchAttachments(
  organizationId: string,
  entityType: AttachmentEntityType,
  entityId: string,
): Promise<Attachment[]> {
  const params = new URLSearchParams({ entityType, entityId });
  const res = await fetch(`${API_URL}/attachments?${params.toString()}`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error('Documents are not available');
  const body = (await res.json()) as { attachments: Attachment[] };
  return body.attachments;
}

export async function uploadAttachment(
  organizationId: string,
  entityType: AttachmentEntityType,
  entityId: string,
  file: File,
): Promise<Attachment> {
  const form = new FormData();
  form.append('entityType', entityType);
  form.append('entityId', entityId);
  form.append('file', file);
  const res = await fetch(`${API_URL}/attachments`, {
    method: 'POST',
    headers: authHeaders(organizationId),
    body: form,
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not attach that file'));
  return res.json();
}

export async function deleteAttachment(
  organizationId: string,
  attachmentId: string,
): Promise<void> {
  const res = await fetch(`${API_URL}/attachments/${attachmentId}`, {
    method: 'DELETE',
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not remove that file'));
}

export async function fetchAttachmentUrl(
  organizationId: string,
  attachmentId: string,
): Promise<string> {
  const res = await fetch(`${API_URL}/attachments/${attachmentId}/url`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'That file is not available'));
  const body = (await res.json()) as { url: string };
  return body.url;
}

export type BankAccountType = 'CHECKING' | 'SAVINGS' | 'CREDIT_CARD';
export type BankImportFormat = 'CSV' | 'OFX';
export type BankTransactionMatchState = 'UNMATCHED' | 'MATCHED' | 'CATEGORIZED';

export interface BankAccount {
  id: string;
  name: string;
  type: BankAccountType;
  active: boolean;
  ledgerAccountId: string;
  ledgerAccount: { id: string; code: string; name: string; type: AccountType };
  transactionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface BankAccountInput {
  name: string;
  type: BankAccountType;
  ledgerAccountId: string;
}

export async function fetchBankAccounts(organizationId: string): Promise<BankAccount[]> {
  const res = await fetch(`${API_URL}/bank-accounts`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error('Bank accounts are not available');
  const body = (await res.json()) as { bankAccounts: BankAccount[] };
  return body.bankAccounts;
}

export async function createBankAccount(
  organizationId: string,
  input: BankAccountInput,
): Promise<BankAccount> {
  const res = await fetch(`${API_URL}/bank-accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not add that bank account'));
  return res.json();
}

export interface CategorizationRule {
  id: string;
  descriptionContains: string;
  targetAccountId: string;
  targetAccount: { id: string; code: string; name: string; type: AccountType };
  priority: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CategorizationRuleInput {
  descriptionContains: string;
  targetAccountId: string;
  priority?: number;
  active?: boolean;
}

export async function fetchCategorizationRules(
  organizationId: string,
): Promise<CategorizationRule[]> {
  const res = await fetch(`${API_URL}/categorization-rules`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error('Categorization rules are not available');
  const body = (await res.json()) as { rules: CategorizationRule[] };
  return body.rules;
}

export async function createCategorizationRule(
  organizationId: string,
  input: CategorizationRuleInput,
): Promise<CategorizationRule> {
  const res = await fetch(`${API_URL}/categorization-rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not save that rule'));
  return res.json();
}

export async function updateCategorizationRule(
  organizationId: string,
  id: string,
  input: Partial<CategorizationRuleInput>,
): Promise<CategorizationRule> {
  const res = await fetch(`${API_URL}/categorization-rules/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not update that rule'));
  return res.json();
}

export async function deleteCategorizationRule(
  organizationId: string,
  id: string,
): Promise<void> {
  const res = await fetch(`${API_URL}/categorization-rules/${id}`, {
    method: 'DELETE',
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not delete that rule'));
}

export interface BankTransaction {
  id: string;
  bankAccountId: string;
  bankAccount: { id: string; name: string; type: string };
  importBatchId: string;
  importBatch: {
    id: string;
    filename: string;
    format: BankImportFormat;
    createdAt: string;
  };
  date: string;
  description: string;
  amount: number;
  externalId: string | null;
  matchState: BankTransactionMatchState;
  categoryAccountId: string | null;
  categoryRuleId: string | null;
  categoryAccount: { id: string; code: string; name: string } | null;
  categoryRule: { id: string; descriptionContains: string } | null;
  matchedEntityType: string | null;
  matchedEntityId: string | null;
  resolutionLabel: string | null;
  resolvedAt: string | null;
  reconciliationSessionId: string | null;
  clearedAt: string | null;
  createdAt: string;
}

export interface BankTransactionFilters {
  bankAccountId?: string;
  from?: string;
  to?: string;
  matchState?: BankTransactionMatchState;
  search?: string;
}

export async function fetchBankTransactions(
  organizationId: string,
  filters: BankTransactionFilters = {},
): Promise<BankTransaction[]> {
  const params = new URLSearchParams();
  if (filters.bankAccountId) params.set('bankAccountId', filters.bankAccountId);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.matchState) params.set('matchState', filters.matchState);
  if (filters.search) params.set('search', filters.search);
  const query = params.toString();
  const res = await fetch(`${API_URL}/bank-transactions${query ? `?${query}` : ''}`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error('Bank transactions are not available');
  const body = (await res.json()) as { transactions: BankTransaction[] };
  return body.transactions;
}

export type MatchEntityType = 'INVOICE' | 'BILL' | 'PAYMENT' | 'EXPENSE';

export interface MatchSuggestion {
  entityType: MatchEntityType;
  entityId: string;
  number: string;
  label: string;
  amount: number;
  date: string;
  score: number;
  rank: number;
  daysFromTransaction: number;
  reasons: string[];
}

export async function fetchMatchSuggestions(
  organizationId: string,
  transactionId: string,
): Promise<MatchSuggestion[]> {
  const res = await fetch(
    `${API_URL}/bank-transactions/${transactionId}/suggestions`,
    { headers: authHeaders(organizationId) },
  );
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not read match suggestions'));
  const body = (await res.json()) as { suggestions: MatchSuggestion[] };
  return body.suggestions;
}

export async function matchBankTransaction(
  organizationId: string,
  transactionId: string,
  entityType: MatchEntityType,
  entityId: string,
): Promise<BankTransaction> {
  const res = await fetch(`${API_URL}/bank-transactions/${transactionId}/match`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify({ entityType, entityId }),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not match that transaction'));
  return res.json();
}

export async function categorizeBankTransaction(
  organizationId: string,
  transactionId: string,
  accountId: string,
): Promise<BankTransaction> {
  const res = await fetch(`${API_URL}/bank-transactions/${transactionId}/categorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify({ accountId }),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not categorize that transaction'));
  return res.json();
}

export async function transferBankTransaction(
  organizationId: string,
  transactionId: string,
  bankAccountId: string,
): Promise<BankTransaction> {
  const res = await fetch(`${API_URL}/bank-transactions/${transactionId}/transfer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify({ bankAccountId }),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not transfer that transaction'));
  return res.json();
}

export interface BankExpenseInput {
  categoryAccountId: string;
  vendorId?: string;
  memo?: string;
}

export async function expenseFromBankTransaction(
  organizationId: string,
  transactionId: string,
  input: BankExpenseInput,
): Promise<BankTransaction> {
  const res = await fetch(`${API_URL}/bank-transactions/${transactionId}/expense`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not create that expense'));
  return res.json();
}

export interface BankPaymentInput {
  customerId: string;
  applications: Array<{ invoiceId: string; amount: number }>;
  reference?: string;
  notes?: string;
}

export async function paymentFromBankTransaction(
  organizationId: string,
  transactionId: string,
  input: BankPaymentInput,
): Promise<BankTransaction> {
  const res = await fetch(`${API_URL}/bank-transactions/${transactionId}/payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not record that payment'));
  return res.json();
}

export type ReconciliationStatus = 'ACTIVE' | 'COMPLETED';

export interface ReconciliationSession {
  id: string;
  bankAccountId: string;
  bankAccount: {
    id: string;
    name: string;
    type: BankAccountType;
    active: boolean;
    ledgerAccount: {
      id: string;
      code: string;
      name: string;
      type: AccountType;
      active: boolean;
    };
  };
  periodStart: string;
  periodEnd: string;
  statementEndingBalance: number;
  openingBalance: number;
  clearedTotal: number;
  clearedBalance: number;
  bookBalance: number;
  difference: number;
  balanced: boolean;
  status: ReconciliationStatus;
  completedAt: string | null;
  completedById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReconciliationTransaction extends BankTransaction {
  cleared: boolean;
  clearedElsewhere: boolean;
}

export interface ReconciliationDetail extends ReconciliationSession {
  clearedCount: number;
  transactionCount: number;
  transactions: ReconciliationTransaction[];
}

export interface CreateReconciliationInput {
  bankAccountId: string;
  periodStart: string;
  periodEnd: string;
  statementEndingBalance: number;
}

export interface ReconciliationFilters {
  bankAccountId?: string;
  status?: ReconciliationStatus;
}

export async function fetchReconciliations(
  organizationId: string,
  filters: ReconciliationFilters = {},
): Promise<ReconciliationSession[]> {
  const params = new URLSearchParams();
  if (filters.bankAccountId) params.set('bankAccountId', filters.bankAccountId);
  if (filters.status) params.set('status', filters.status);
  const query = params.toString();
  const res = await fetch(`${API_URL}/reconciliations${query ? `?${query}` : ''}`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not read reconciliations'));
  const body = (await res.json()) as { sessions: ReconciliationSession[] };
  return body.sessions;
}

export async function fetchReconciliation(
  organizationId: string,
  sessionId: string,
): Promise<ReconciliationDetail> {
  const res = await fetch(`${API_URL}/reconciliations/${sessionId}`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not read that reconciliation'));
  return res.json();
}

export async function createReconciliation(
  organizationId: string,
  input: CreateReconciliationInput,
): Promise<ReconciliationDetail> {
  const res = await fetch(`${API_URL}/reconciliations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not start that reconciliation'));
  return res.json();
}

export async function completeReconciliation(
  organizationId: string,
  sessionId: string,
): Promise<ReconciliationDetail> {
  const res = await fetch(`${API_URL}/reconciliations/${sessionId}/complete`, {
    method: 'POST',
    headers: authHeaders(organizationId),
  });
  if (!res.ok) {
    throw new Error(await failureMessage(res, 'Could not complete that reconciliation'));
  }
  return res.json();
}

export async function undoReconciliation(
  organizationId: string,
  sessionId: string,
): Promise<ReconciliationDetail> {
  const res = await fetch(`${API_URL}/reconciliations/${sessionId}/undo`, {
    method: 'POST',
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not undo that reconciliation'));
  return res.json();
}

export async function setReconciliationCleared(
  organizationId: string,
  sessionId: string,
  transactionId: string,
  cleared: boolean,
): Promise<ReconciliationDetail> {
  const res = await fetch(
    `${API_URL}/reconciliations/${sessionId}/transactions/${transactionId}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
      body: JSON.stringify({ cleared }),
    },
  );
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not update that clearance'));
  return res.json();
}

export interface BankImportMapping {
  dateColumn?: string;
  descriptionColumn?: string;
  amountColumn?: string;
  debitColumn?: string;
  creditColumn?: string;
  externalIdColumn?: string;
}

export interface BankImportCounts {
  total: number;
  valid: number;
  invalid: number;
  duplicate: number;
  newCount: number;
}

export interface BankImportPreviewRow {
  rowNumber: number;
  date: string | null;
  description: string;
  amount: number | null;
  externalId: string | null;
  valid: boolean;
  duplicate: boolean;
  error: string | null;
  rule: {
    id: string;
    descriptionContains: string;
    targetAccountId: string;
    targetAccount: { id: string; code: string; name: string; type: AccountType };
  } | null;
}

export interface BankImportPreview {
  filename: string;
  format: BankImportFormat;
  headers: string[];
  mapping: {
    date: string | null;
    description: string | null;
    amount: string | null;
    debit: string | null;
    credit: string | null;
    externalId: string | null;
  } | null;
  mappingError: string | null;
  rows: BankImportPreviewRow[];
  counts: BankImportCounts;
}

export interface BankImportBatch {
  id: string;
  bankAccountId: string;
  filename: string;
  format: BankImportFormat;
  rowCount: number;
  importedCount: number;
  duplicateCount: number;
  invalidCount: number;
  createdAt: string;
}

export interface ImportedBankTransaction {
  id: string;
  bankAccountId: string;
  importBatchId: string;
  date: string;
  description: string;
  amount: number;
  externalId: string | null;
  matchState: BankTransactionMatchState;
  categoryAccountId: string | null;
  categoryRuleId: string | null;
  categoryAccount: { id: string; code: string; name: string } | null;
  categoryRule: { id: string; descriptionContains: string } | null;
  createdAt: string;
}

export interface BankImportResult {
  batch: BankImportBatch;
  transactions: ImportedBankTransaction[];
}

function bankImportForm(
  bankAccountId: string,
  file: File,
  mapping: BankImportMapping,
): FormData {
  const form = new FormData();
  form.append('bankAccountId', bankAccountId);
  form.append('file', file);
  for (const [field, value] of Object.entries(mapping)) {
    if (typeof value === 'string' && value) form.append(field, value);
  }
  return form;
}

export async function previewBankImport(
  organizationId: string,
  bankAccountId: string,
  file: File,
  mapping: BankImportMapping = {},
): Promise<BankImportPreview> {
  const res = await fetch(`${API_URL}/bank-imports/preview`, {
    method: 'POST',
    headers: authHeaders(organizationId),
    body: bankImportForm(bankAccountId, file, mapping),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not preview that bank file'));
  return res.json();
}

export async function importBankTransactions(
  organizationId: string,
  bankAccountId: string,
  file: File,
  mapping: BankImportMapping = {},
): Promise<BankImportResult> {
  const res = await fetch(`${API_URL}/bank-imports`, {
    method: 'POST',
    headers: authHeaders(organizationId),
    body: bankImportForm(bankAccountId, file, mapping),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not import that bank file'));
  return res.json();
}

export type AgentTrigger = 'PROMPT' | 'CRON' | 'EVENT';
export type AgentJobStatus = 'QUEUED' | 'RUNNING' | 'RETRYING' | 'COMPLETED' | 'FAILED';
export type AgentProposalStatus =
  | 'PENDING'
  | 'EXECUTING'
  | 'EXECUTED'
  | 'REJECTED'
  | 'FAILED';

export interface AgentLogEntry {
  id: string;
  organizationId: string;
  actorUserId: string | null;
  trigger: AgentTrigger;
  status: AgentJobStatus;
  model: string | null;
  prompt: string | null;
  toolNames: string[] | null;
  input: unknown;
  output: unknown;
  error: string | null;
  jobId: string | null;
  proposalId: string | null;
  approvalStatus: AgentProposalStatus | null;
  logReference: string;
  createdAt: string;
  actor?: { id: string; name: string; email: string } | null;
}

export interface AgentProposal {
  id: string;
  organizationId: string;
  jobId: string | null;
  requestedByUserId: string;
  toolName: string;
  args: unknown;
  rationale: string | null;
  status: AgentProposalStatus;
  decidedByUserId: string | null;
  decidedAt: string | null;
  executedAt: string | null;
  decisionNote: string | null;
  result: unknown;
  error: string | null;
  logReference: string | null;
  createdAt: string;
  updatedAt: string;
  requestedBy?: { id: string; name: string; email: string } | null;
  decidedBy?: { id: string; name: string; email: string } | null;
}

export interface AgentJob {
  jobId: string;
  status: AgentJobStatus;
  attempts: number;
  maxAttempts: number;
  model: string;
  prompt: string;
  response: string | null;
  error: string | null;
  toolNames: string[];
  logReference: string | null;
  createdAt: string;
  updatedAt: string;
  logs: AgentLogEntry[];
  proposals?: AgentProposal[];
}

export interface AgentPromptSubmission {
  jobId: string;
  status: AgentJobStatus;
  logReference: string;
}

export async function submitAgentPrompt(
  organizationId: string,
  prompt: string,
  model?: string,
): Promise<AgentPromptSubmission> {
  const res = await fetch(`${API_URL}/agent/prompts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify({ prompt, ...(model ? { model } : {}) }),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not send that prompt'));
  return res.json();
}

export async function fetchAgentJob(
  organizationId: string,
  jobId: string,
): Promise<AgentJob> {
  const res = await fetch(`${API_URL}/agent/jobs/${jobId}`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Agent job not available'));
  return res.json();
}

export async function fetchAgentLogs(
  organizationId: string,
  filters: { trigger?: AgentTrigger; status?: AgentJobStatus; jobId?: string; limit?: number } = {},
): Promise<AgentLogEntry[]> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const query = params.toString();
  const res = await fetch(`${API_URL}/agent/logs${query ? `?${query}` : ''}`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Agent activity is not available'));
  const body = (await res.json()) as { logs: AgentLogEntry[] };
  return body.logs;
}

export async function fetchAgentLog(
  organizationId: string,
  logId: string,
): Promise<AgentLogEntry> {
  const res = await fetch(`${API_URL}/agent/logs/${logId}`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Agent log entry not available'));
  return res.json();
}

export async function fetchAgentApprovals(
  organizationId: string,
  filters: { status?: AgentProposalStatus; jobId?: string; limit?: number } = {},
): Promise<AgentProposal[]> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const query = params.toString();
  const res = await fetch(`${API_URL}/agent/approvals${query ? `?${query}` : ''}`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Agent approvals are not available'));
  const body = (await res.json()) as { approvals: AgentProposal[] };
  return body.approvals;
}

export async function fetchAgentApproval(
  organizationId: string,
  proposalId: string,
): Promise<AgentProposal> {
  const res = await fetch(`${API_URL}/agent/approvals/${proposalId}`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Agent proposal not available'));
  return res.json();
}

export async function approveAgentProposal(
  organizationId: string,
  proposalId: string,
): Promise<AgentProposal> {
  const res = await fetch(`${API_URL}/agent/approvals/${proposalId}/approve`, {
    method: 'POST',
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not approve that proposal'));
  return res.json();
}

export async function rejectAgentProposal(
  organizationId: string,
  proposalId: string,
  reason?: string,
): Promise<AgentProposal> {
  const res = await fetch(`${API_URL}/agent/approvals/${proposalId}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify(reason ? { reason } : {}),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not reject that proposal'));
  return res.json();
}

export type AgentPolicyMode = 'auto' | 'approve';

export interface AgentPolicyView {
  id: string | null;
  toolName: string;
  description: string;
  permission: string;
  readOnly: boolean;
  sensitive: boolean;
  configurable: boolean;
  defaultPolicy: AgentPolicyMode;
  policy: AgentPolicyMode;
  updatedAt: string | null;
  updatedBy: { id: string; name: string; email: string } | null;
}

export async function fetchAgentPolicies(
  organizationId: string,
): Promise<AgentPolicyView[]> {
  const res = await fetch(`${API_URL}/agent/policies`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Agent policies are not available'));
  const body = (await res.json()) as { policies: AgentPolicyView[] };
  return body.policies;
}

export async function updateAgentPolicy(
  organizationId: string,
  toolName: string,
  policy: AgentPolicyMode,
): Promise<AgentPolicyView> {
  const res = await fetch(`${API_URL}/agent/policies/${encodeURIComponent(toolName)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify({ policy }),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not save that policy'));
  return res.json();
}

export type AgentAutomationMode = 'CRON' | 'EVENT';

export interface AgentAutomation {
  id: string;
  name: string;
  mode: AgentAutomationMode;
  cron: string;
  timezone: string;
  prompt: string;
  model: string | null;
  enabled: boolean;
  scheduleLabel: string;
  nextRunAt: string | null;
  createdBy: { id: string; name: string; email: string } | null;
  lastRunAt: string | null;
  lastStatus: AgentJobStatus | null;
  lastJobId: string | null;
  lastLogReference: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentAutomationInput {
  name: string;
  prompt: string;
  cron: string;
  timezone?: string;
  enabled?: boolean;
}

export async function fetchAgentAutomations(
  organizationId: string,
): Promise<AgentAutomation[]> {
  const res = await fetch(`${API_URL}/agent/automations`, {
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Automations are not available'));
  const body = (await res.json()) as { automations: AgentAutomation[] };
  return body.automations;
}

export async function createAgentAutomation(
  organizationId: string,
  input: AgentAutomationInput,
): Promise<AgentAutomation> {
  const res = await fetch(`${API_URL}/agent/automations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not create that automation'));
  return res.json();
}

export async function updateAgentAutomation(
  organizationId: string,
  id: string,
  input: Partial<AgentAutomationInput>,
): Promise<AgentAutomation> {
  const res = await fetch(`${API_URL}/agent/automations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders(organizationId) },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not update that automation'));
  return res.json();
}

export async function deleteAgentAutomation(
  organizationId: string,
  id: string,
): Promise<void> {
  const res = await fetch(`${API_URL}/agent/automations/${id}`, {
    method: 'DELETE',
    headers: authHeaders(organizationId),
  });
  if (!res.ok) throw new Error(await failureMessage(res, 'Could not delete that automation'));
}
