'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppSpine } from '@/components/app-spine';
import {
  API_URL,
  Account,
  AccountType,
  ActiveOrganization,
  BankAccount,
  BankAccountType,
  BankImportMapping,
  BankImportPreview,
  BankImportPreviewRow,
  BankTransaction,
  BankTransactionMatchState,
  CategorizationRule,
  Customer,
  Invoice,
  MatchEntityType,
  MatchSuggestion,
  Vendor,
  categorizeBankTransaction,
  clearSession,
  createBankAccount,
  createCategorizationRule,
  deleteCategorizationRule,
  expenseFromBankTransaction,
  fetchAccounts,
  fetchActiveOrganization,
  fetchBankAccounts,
  fetchBankTransactions,
  fetchCategorizationRules,
  fetchCustomers,
  fetchInvoices,
  fetchMatchSuggestions,
  fetchVendors,
  getAccessToken,
  getActiveOrgId,
  importBankTransactions,
  matchBankTransaction,
  paymentFromBankTransaction,
  previewBankImport,
  setActiveOrgId,
  transferBankTransaction,
  updateCategorizationRule,
} from '@/lib/api';

const ACCOUNT_TYPES: Array<{ value: BankAccountType; label: string }> = [
  { value: 'CHECKING', label: 'Checking' },
  { value: 'SAVINGS', label: 'Savings' },
  { value: 'CREDIT_CARD', label: 'Credit card' },
];

const MATCH_STATES: Array<{ value: BankTransactionMatchState; label: string }> = [
  { value: 'UNMATCHED', label: 'Unmatched' },
  { value: 'MATCHED', label: 'Matched' },
  { value: 'CATEGORIZED', label: 'Categorized' },
];

const RESOLVE_MODE_LABELS: Record<ResolveMode, string> = {
  match: 'Match existing',
  categorize: 'Categorize',
  expense: 'Create expense',
  payment: 'Record payment',
  transfer: 'Transfer',
};

const MATCH_TYPE_LABELS: Record<MatchEntityType, string> = {
  INVOICE: 'Invoice',
  BILL: 'Bill',
  PAYMENT: 'Payment',
  EXPENSE: 'Expense',
};

const MATCH_CLASS: Record<BankTransactionMatchState, string> = {
  UNMATCHED: 'status--draft',
  MATCHED: 'status--paid',
  CATEGORIZED: 'status--sent',
};

interface AccountForm {
  name: string;
  type: BankAccountType;
  ledgerAccountId: string;
}

interface RuleForm {
  descriptionContains: string;
  targetAccountId: string;
  priority: string;
  active: boolean;
}

type ResolveMode = 'match' | 'categorize' | 'expense' | 'payment' | 'transfer';


function money(value: number): string {
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function signedMoney(value: number): string {
  return value < 0 ? `-${money(Math.abs(value))}` : money(value);
}

function displayDate(value: string): string {
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function canManage(role: string): boolean {
  return ['OWNER', 'ADMIN', 'ACCOUNTANT', 'STAFF'].includes(role);
}

function typeLabel(type: BankAccountType): string {
  return ACCOUNT_TYPES.find((entry) => entry.value === type)?.label ?? type;
}

function requiredLedgerType(type: BankAccountType): AccountType {
  return type === 'CREDIT_CARD' ? 'LIABILITY' : 'ASSET';
}

function mappingFromPreview(preview: BankImportPreview): BankImportMapping {
  if (!preview.mapping) return {};
  return {
    dateColumn: preview.mapping.date ?? undefined,
    descriptionColumn: preview.mapping.description ?? undefined,
    amountColumn: preview.mapping.amount ?? undefined,
    debitColumn: preview.mapping.debit ?? undefined,
    creditColumn: preview.mapping.credit ?? undefined,
    externalIdColumn: preview.mapping.externalId ?? undefined,
  };
}

function previewStatus(row: BankImportPreviewRow): string {
  if (!row.valid) return 'Invalid';
  if (row.duplicate) return 'Duplicate';
  return 'New';
}

export default function BankingPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [org, setOrg] = useState<ActiveOrganization | null>(null);
  const [accounts, setAccounts] = useState<BankAccount[] | null>(null);
  const [ledgerAccounts, setLedgerAccounts] = useState<Account[]>([]);
  const [rules, setRules] = useState<CategorizationRule[] | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<BankTransaction[] | null>(null);
  const [matchFilter, setMatchFilter] = useState<'' | BankTransactionMatchState>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [accountFormOpen, setAccountFormOpen] = useState(false);
  const [accountForm, setAccountForm] = useState<AccountForm>({
    name: '',
    type: 'CHECKING',
    ledgerAccountId: '',
  });
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountBusy, setAccountBusy] = useState(false);

  const [ruleFormOpen, setRuleFormOpen] = useState(false);
  const [ruleEditing, setRuleEditing] = useState<CategorizationRule | null>(null);
  const [ruleForm, setRuleForm] = useState<RuleForm>({
    descriptionContains: '',
    targetAccountId: '',
    priority: '100',
    active: true,
  });
  const [ruleError, setRuleError] = useState<string | null>(null);
  const [ruleBusy, setRuleBusy] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<BankImportPreview | null>(null);
  const [importMapping, setImportMapping] = useState<BankImportMapping>({});
  const [importError, setImportError] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);

  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveTransaction, setResolveTransaction] = useState<BankTransaction | null>(null);
  const [resolveMode, setResolveMode] = useState<ResolveMode>('match');
  const [matchSuggestions, setMatchSuggestions] = useState<MatchSuggestion[] | null>(null);
  const [matchSelectedKey, setMatchSelectedKey] = useState('');
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [resolveAccountId, setResolveAccountId] = useState('');
  const [resolveCategoryId, setResolveCategoryId] = useState('');
  const [resolveVendorId, setResolveVendorId] = useState('');
  const [resolveMemo, setResolveMemo] = useState('');
  const [resolveCustomerId, setResolveCustomerId] = useState('');
  const [resolveInvoiceId, setResolveInvoiceId] = useState('');
  const [resolveInvoices, setResolveInvoices] = useState<Invoice[]>([]);
  const [resolveInvoicesLoading, setResolveInvoicesLoading] = useState(false);
  const [resolveTargetBankId, setResolveTargetBankId] = useState('');
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolveBusy, setResolveBusy] = useState(false);

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => {
      setToast(null);
      toastTimer.current = null;
    }, 3600);
  }, []);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace('/login');
      return;
    }
    let cancelled = false;
    (async () => {
      const me = await fetch(`${API_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!me.ok) throw new Error('unauthorized');
      const session = (await me.json()) as {
        memberships: { organizationId: string; organizationName: string; role: string }[];
      };
      const stored = getActiveOrgId();
      const initial =
        session.memberships.find((m) => m.organizationId === stored) ?? session.memberships[0];
      if (!initial) throw new Error('no organization');
      const activeOrg = await fetchActiveOrganization(initial.organizationId);
      const [accountRows, bankAccountRows, ruleRows, customerRows, vendorRows] =
        await Promise.all([
          fetchAccounts(activeOrg.organizationId),
          fetchBankAccounts(activeOrg.organizationId),
          fetchCategorizationRules(activeOrg.organizationId),
          fetchCustomers(activeOrg.organizationId, { active: true }),
          fetchVendors(activeOrg.organizationId, { active: true }),
        ]);
      if (cancelled) return;
      setActiveOrgId(activeOrg.organizationId);
      setOrg(activeOrg);
      setLedgerAccounts(accountRows);
      setAccounts(bankAccountRows);
      setRules(ruleRows);
      setCustomers(customerRows);
      setVendors(vendorRows);
      setSelectedId(bankAccountRows[0]?.id ?? null);
      setReady(true);
    })().catch(() => {
      if (cancelled) return;
      clearSession();
      router.replace('/login');
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const selected = useMemo(
    () => accounts?.find((account) => account.id === selectedId) ?? null,
    [accounts, selectedId],
  );

  const eligibleLedgerAccounts = useMemo(() => {
    const required = requiredLedgerType(accountForm.type);
    return ledgerAccounts.filter((account) => account.active && account.type === required);
  }, [accountForm.type, ledgerAccounts]);

  const loadTransactions = useCallback(async () => {
    if (!org || !selectedId) {
      setTransactions([]);
      return;
    }
    try {
      setTransactions(
        await fetchBankTransactions(org.organizationId, {
          bankAccountId: selectedId,
          from: from || undefined,
          to: to || undefined,
          matchState: matchFilter || undefined,
          search: search.trim() || undefined,
        }),
      );
      setError(null);
    } catch {
      setError('Bank transactions are not available right now.');
    }
  }, [org, selectedId, from, to, matchFilter, search]);

  useEffect(() => {
    if (!org) return;
    if (!selectedId) {
      setTransactions([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void loadTransactions();
    }, 200);
    return () => window.clearTimeout(timer);
  }, [loadTransactions, org, selectedId]);

  useEffect(() => {
    if (!org || !resolveOpen || resolveMode !== 'payment' || !resolveCustomerId) {
      setResolveInvoices([]);
      setResolveInvoiceId('');
      return;
    }
    let cancelled = false;
    setResolveInvoicesLoading(true);
    fetchInvoices(org.organizationId, { customerId: resolveCustomerId })
      .then((rows) => {
        if (cancelled) return;
        const open = rows.filter(
          (invoice) =>
            (invoice.status === 'SENT' || invoice.status === 'PARTIAL') &&
            invoice.balanceDue > 0,
        );
        setResolveInvoices(open);
        setResolveInvoiceId((current) =>
          current && open.some((invoice) => invoice.id === current)
            ? current
            : open[0]?.id ?? '',
        );
        setResolveError(null);
      })
      .catch(() => {
        if (!cancelled) setResolveError('Open invoices are not available right now.');
      })
      .finally(() => {
        if (!cancelled) setResolveInvoicesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [org, resolveOpen, resolveMode, resolveCustomerId]);

  useEffect(() => {
    if (!org || !resolveOpen || resolveMode !== 'match' || !resolveTransaction) return;
    let cancelled = false;
    setMatchLoading(true);
    setMatchError(null);
    setMatchSuggestions(null);
    setMatchSelectedKey('');
    fetchMatchSuggestions(org.organizationId, resolveTransaction.id)
      .then((rows) => {
        if (cancelled) return;
        setMatchSuggestions(rows);
        setMatchSelectedKey(
          rows[0] ? `${rows[0].entityType}:${rows[0].entityId}` : '',
        );
      })
      .catch((err) => {
        if (!cancelled) {
          setMatchError(
            err instanceof Error ? err.message : 'Match suggestions are not available',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setMatchLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [org, resolveOpen, resolveMode, resolveTransaction]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setAccountFormOpen(false);
      setRuleFormOpen(false);
      setImportOpen(false);
      setResolveOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const refreshAccounts = useCallback(async () => {
    if (!org) return;
    const rows = await fetchBankAccounts(org.organizationId);
    setAccounts(rows);
    setSelectedId((current) => {
      if (current && rows.some((row) => row.id === current)) return current;
      return rows[0]?.id ?? null;
    });
  }, [org]);

  const refreshRules = useCallback(async () => {
    if (!org) return;
    setRules(await fetchCategorizationRules(org.organizationId));
  }, [org]);

  function openRuleForm(rule?: CategorizationRule) {
    setRuleEditing(rule ?? null);
    setRuleForm(
      rule
        ? {
            descriptionContains: rule.descriptionContains,
            targetAccountId: rule.targetAccountId,
            priority: String(rule.priority),
            active: rule.active,
          }
        : {
            descriptionContains: '',
            targetAccountId: '',
            priority: '100',
            active: true,
          },
    );
    setRuleError(null);
    setRuleFormOpen(true);
  }

  function setRuleField<K extends keyof RuleForm>(field: K, value: RuleForm[K]) {
    setRuleForm((current) => ({ ...current, [field]: value }));
  }

  async function onSaveRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!org || ruleBusy) return;
    const descriptionContains = ruleForm.descriptionContains.trim();
    const priority = Number(ruleForm.priority);
    if (!descriptionContains) {
      setRuleError('Choose the text a description must contain.');
      return;
    }
    if (!ruleForm.targetAccountId) {
      setRuleError('Choose the account matching transactions post to.');
      return;
    }
    if (!Number.isInteger(priority) || priority < 0 || priority > 1000) {
      setRuleError('Priority must be a whole number from 0 to 1000.');
      return;
    }
    setRuleBusy(true);
    setRuleError(null);
    try {
      if (ruleEditing) {
        const saved = await updateCategorizationRule(org.organizationId, ruleEditing.id, {
          descriptionContains,
          targetAccountId: ruleForm.targetAccountId,
          priority,
          active: ruleForm.active,
        });
        showToast(`Rule “${saved.descriptionContains}” updated.`);
      } else {
        const saved = await createCategorizationRule(org.organizationId, {
          descriptionContains,
          targetAccountId: ruleForm.targetAccountId,
          priority,
          active: ruleForm.active,
        });
        showToast(`Rule “${saved.descriptionContains}” added.`);
      }
      setRuleFormOpen(false);
      await refreshRules();
    } catch (err) {
      setRuleError(err instanceof Error ? err.message : 'Could not save that rule');
    } finally {
      setRuleBusy(false);
    }
  }

  async function onToggleRule(rule: CategorizationRule) {
    if (!org) return;
    try {
      const saved = await updateCategorizationRule(org.organizationId, rule.id, {
        active: !rule.active,
      });
      await refreshRules();
      showToast(`${saved.descriptionContains} ${saved.active ? 'resumed' : 'paused'}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update that rule');
    }
  }

  async function onDeleteRule(rule: CategorizationRule) {
    if (!org) return;
    try {
      await deleteCategorizationRule(org.organizationId, rule.id);
      if (ruleEditing?.id === rule.id) setRuleFormOpen(false);
      await refreshRules();
      showToast(`Rule “${rule.descriptionContains}” deleted.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete that rule');
    }
  }

  function openResolve(transaction: BankTransaction) {
    setResolveTransaction(transaction);
    setResolveMode('match');
    setMatchSuggestions(null);
    setMatchSelectedKey('');
    setMatchError(null);
    setResolveAccountId('');
    setResolveCategoryId('');
    setResolveVendorId('');
    setResolveMemo(transaction.description);
    setResolveCustomerId('');
    setResolveInvoiceId('');
    setResolveInvoices([]);
    setResolveTargetBankId('');
    setResolveError(null);
    setResolveOpen(true);
  }

  async function onResolveTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!org || !resolveTransaction || resolveBusy) return;
    const amount = Math.abs(resolveTransaction.amount);
    const selectedMatch = matchSuggestions?.find(
      (row) => `${row.entityType}:${row.entityId}` === matchSelectedKey,
    );
    setResolveError(null);

    if (resolveMode === 'match' && !selectedMatch) {
      setResolveError('Choose a suggested record to match.');
      return;
    }
    if (resolveMode === 'categorize' && !resolveAccountId) {
      setResolveError('Choose the account this transaction belongs to.');
      return;
    }
    if (resolveMode === 'expense' && !resolveCategoryId) {
      setResolveError('Choose an expense category.');
      return;
    }
    if (resolveMode === 'payment') {
      if (!resolveCustomerId) {
        setResolveError('Choose the customer who paid.');
        return;
      }
      if (!resolveInvoiceId) {
        setResolveError('Choose an open invoice to apply this payment to.');
        return;
      }
      const invoice = resolveInvoices.find((row) => row.id === resolveInvoiceId);
      if (!invoice || invoice.balanceDue < amount) {
        setResolveError('That invoice does not have enough balance for this payment.');
        return;
      }
    }
    if (resolveMode === 'transfer' && !resolveTargetBankId) {
      setResolveError('Choose the bank account to transfer to.');
      return;
    }

    setResolveBusy(true);
    try {
      let resolved: BankTransaction;
      if (resolveMode === 'match') {
        if (!selectedMatch) throw new Error('Choose a suggested record to match');
        resolved = await matchBankTransaction(
          org.organizationId,
          resolveTransaction.id,
          selectedMatch.entityType,
          selectedMatch.entityId,
        );
      } else if (resolveMode === 'categorize') {
        resolved = await categorizeBankTransaction(
          org.organizationId,
          resolveTransaction.id,
          resolveAccountId,
        );
      } else if (resolveMode === 'expense') {
        resolved = await expenseFromBankTransaction(org.organizationId, resolveTransaction.id, {
          categoryAccountId: resolveCategoryId,
          vendorId: resolveVendorId || undefined,
          memo: resolveMemo.trim() || undefined,
        });
      } else if (resolveMode === 'payment') {
        resolved = await paymentFromBankTransaction(org.organizationId, resolveTransaction.id, {
          customerId: resolveCustomerId,
          applications: [{ invoiceId: resolveInvoiceId, amount }],
          reference: resolveTransaction.description.slice(0, 100),
        });
      } else {
        resolved = await transferBankTransaction(
          org.organizationId,
          resolveTransaction.id,
          resolveTargetBankId,
        );
      }
      setResolveOpen(false);
      await loadTransactions();
      showToast(
        resolveMode === 'match' && resolved.resolutionLabel
          ? `Transaction matched to ${resolved.resolutionLabel}.`
          : resolved.resolutionLabel
            ? `Transaction resolved as ${resolved.resolutionLabel}.`
            : 'Transaction resolved.',
      );
    } catch (err) {
      setResolveError(
        err instanceof Error ? err.message : 'Could not resolve that transaction',
      );
    } finally {
      setResolveBusy(false);
    }
  }

  function openAccountForm() {
    const required = requiredLedgerType('CHECKING');
    const first = ledgerAccounts.find(
      (account) => account.active && account.type === required,
    );
    setAccountForm({ name: '', type: 'CHECKING', ledgerAccountId: first?.id ?? '' });
    setAccountError(null);
    setAccountFormOpen(true);
  }

  function setAccountType(type: BankAccountType) {
    const required = requiredLedgerType(type);
    setAccountForm((current) => {
      const ledger = ledgerAccounts.find(
        (account) => account.active && account.type === required,
      );
      return {
        ...current,
        type,
        ledgerAccountId:
          ledgerAccounts.find(
            (account) => account.id === current.ledgerAccountId && account.type === required,
          )?.id ?? ledger?.id ?? '',
      };
    });
  }

  async function onAddAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!org || accountBusy) return;
    if (!accountForm.name.trim()) {
      setAccountError('Give this account a name.');
      return;
    }
    if (!accountForm.ledgerAccountId) {
      setAccountError('Choose the ledger account it posts to.');
      return;
    }
    setAccountBusy(true);
    setAccountError(null);
    try {
      const saved = await createBankAccount(org.organizationId, {
        name: accountForm.name.trim(),
        type: accountForm.type,
        ledgerAccountId: accountForm.ledgerAccountId,
      });
      setAccountFormOpen(false);
      await refreshAccounts();
      setSelectedId(saved.id);
      showToast(`${saved.name} added to the banking workspace.`);
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : 'Could not add that bank account');
    } finally {
      setAccountBusy(false);
    }
  }

  function openImport() {
    setImportFile(null);
    setImportPreview(null);
    setImportMapping({});
    setImportError(null);
    setImportOpen(true);
  }

  function onImportFile(file: File | null) {
    setImportFile(file);
    setImportPreview(null);
    setImportMapping({});
    setImportError(null);
  }

  async function runPreview(mapping = importMapping) {
    if (!org || !selected || !importFile || importBusy) return;
    setImportBusy(true);
    setImportError(null);
    try {
      const preview = await previewBankImport(
        org.organizationId,
        selected.id,
        importFile,
        mapping,
      );
      setImportPreview(preview);
      setImportMapping(mappingFromPreview(preview));
    } catch (err) {
      setImportPreview(null);
      setImportError(err instanceof Error ? err.message : 'Could not preview that bank file');
    } finally {
      setImportBusy(false);
    }
  }

  function setMapping(field: keyof BankImportMapping, value: string) {
    setImportMapping((current) => ({ ...current, [field]: value || undefined }));
  }

  async function onConfirmImport() {
    if (!org || !selected || !importFile || !importPreview || importBusy) return;
    if (importPreview.mappingError) return;
    const categorizedCount = importPreview.rows.filter(
      (row) => row.valid && !row.duplicate && row.rule,
    ).length;
    setImportBusy(true);
    setImportError(null);
    try {
      const result = await importBankTransactions(
        org.organizationId,
        selected.id,
        importFile,
        importMapping,
      );
      setImportOpen(false);
      await refreshAccounts();
      await loadTransactions();
      const batch = result.batch;
      const parts = [
        `Imported ${batch.importedCount} transaction${batch.importedCount === 1 ? '' : 's'}`,
      ];
      if (batch.duplicateCount > 0) {
        parts.push(
          `${batch.duplicateCount} duplicate${batch.duplicateCount === 1 ? '' : 's'} skipped`,
        );
      }
      if (batch.invalidCount > 0) {
        parts.push(
          `${batch.invalidCount} invalid row${batch.invalidCount === 1 ? '' : 's'} ignored`,
        );
      }
      if (categorizedCount > 0) {
        parts.push(
          `${categorizedCount} categorized by rule${categorizedCount === 1 ? '' : 's'}`,
        );
      }
      showToast(`${parts.join('; ')}.`);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Could not import that bank file');
    } finally {
      setImportBusy(false);
    }
  }

  if (!ready) {
    return (
      <main className="app-loading">
        <p className="app-loading__hint">Opening the bank book…</p>
      </main>
    );
  }

  const editable = canManage(org?.role ?? '');
  const rows = transactions ?? [];
  const unmatched = rows.filter((row) => row.matchState === 'UNMATCHED').length;
  const previewRuleCount =
    importPreview?.rows.filter((row) => row.valid && !row.duplicate && row.rule).length ?? 0;
  const resolveAmount = resolveTransaction ? Math.abs(resolveTransaction.amount) : 0;
  const resolveModes: ResolveMode[] = resolveTransaction
    ? [
        'match',
        ...(resolveTransaction.amount > 0
          ? (['categorize', 'payment', 'transfer'] as ResolveMode[])
          : (['categorize', 'expense', 'transfer'] as ResolveMode[])),
      ]
    : [];
  const selectedResolveInvoice =
    resolveInvoices.find((invoice) => invoice.id === resolveInvoiceId) ?? null;
  const paymentCoversBalance = selectedResolveInvoice
    ? selectedResolveInvoice.balanceDue >= resolveAmount
    : false;
  const resolveSourceBank =
    accounts?.find((account) => account.id === resolveTransaction?.bankAccountId) ?? null;
  const resolveSubmitLabel = resolveBusy
    ? 'Working…'
    : resolveMode === 'match'
      ? 'Match transaction'
      : resolveMode === 'categorize'
      ? 'Categorize transaction'
      : resolveMode === 'expense'
        ? 'Create expense'
        : resolveMode === 'payment'
          ? 'Record payment'
          : 'Transfer funds';

  return (
    <>
      <div className="app-shell app-shell--accounts">
        <AppSpine active="banking" org={org} />

        <main className="page" id="main">
          <header className="page-head">
            <div>
              <h1>Banking</h1>
              <p className="page-head__meta">
                {accounts?.length ?? 0} bank {accounts?.length === 1 ? 'account' : 'accounts'}.
                {' '}
                {selected ? `${selected.name} · ${selected.transactionCount} transactions.` : 'Start by adding an account.'}
              </p>
            </div>
            {editable ? (
              <div className="page-head__actions">
                <button className="btn btn--ghost" type="button" onClick={openAccountForm}>
                  New bank account
                </button>
                <button
                  className="btn btn--primary"
                  type="button"
                  onClick={openImport}
                  disabled={!selected}
                >
                  Import transactions
                </button>
              </div>
            ) : null}
          </header>

          <div className="stats">
            <div className="stat">
              <div className="stat__label">Bank accounts</div>
              <div className="stat__value">{accounts?.length ?? 0}</div>
            </div>
            <div className="stat">
              <div className="stat__label">Shown here</div>
              <div className="stat__value">{rows.length}</div>
            </div>
            <div className="stat">
              <div className="stat__label">Unmatched</div>
              <div className="stat__value">{unmatched}</div>
            </div>
          </div>

          <section className="bank-accounts" aria-labelledby="bank-accounts-title">
            <div className="section-head">
              <h2 id="bank-accounts-title">Accounts</h2>
              <p className="section__meta">
                Imported activity lands here before it is matched to the books.
              </p>
            </div>

            <div className="table-scroll">
              <table className="data-table bank-account-table">
                <caption className="sr-only">Bank and credit card accounts</caption>
                <thead>
                  <tr>
                    <th scope="col">Account</th>
                    <th scope="col">Type</th>
                    <th scope="col">Ledger account</th>
                    <th scope="col" className="num">
                      Transactions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {accounts === null ? (
                    <tr>
                      <td colSpan={4} className="accounts-empty">
                        Turning the pages…
                      </td>
                    </tr>
                  ) : accounts.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="accounts-empty">
                        No bank accounts yet. Add the checking or card account you want to work from.
                      </td>
                    </tr>
                  ) : (
                    accounts.map((account) => (
                      <tr
                        key={account.id}
                        className={`bank-account-row is-clickable${
                          account.id === selectedId ? ' is-selected' : ''
                        }`}
                        tabIndex={0}
                        onClick={() => setSelectedId(account.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setSelectedId(account.id);
                          }
                        }}
                      >
                        <td>
                          <span className="bank-account-name">{account.name}</span>
                        </td>
                        <td>{typeLabel(account.type)}</td>
                        <td>
                          {account.ledgerAccount.code} · {account.ledgerAccount.name}
                        </td>
                        <td className="num">{account.transactionCount}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="categorization-rules" aria-labelledby="categorization-rules-title">
            <div className="section-head">
              <div>
                <h2 id="categorization-rules-title">Categorization rules</h2>
              </div>
              <div className="bank-rule-head">
                <p className="section__meta">
                  Case-insensitive “if description contains” rules. Lower priority numbers win;
                  ties go to the older rule, and each transaction uses only one rule.
                </p>
                {editable ? (
                  <button
                    className="btn btn--ghost btn--sm"
                    type="button"
                    onClick={() => openRuleForm()}
                  >
                    New rule
                  </button>
                ) : null}
              </div>
            </div>

            <div className="table-scroll">
              <table className="data-table rules-table">
                <caption className="sr-only">Categorization rules applied during bank import</caption>
                <thead>
                  <tr>
                    <th scope="col">If description contains</th>
                    <th scope="col">Categorize as</th>
                    <th scope="col" className="num">
                      Priority
                    </th>
                    <th scope="col">Status</th>
                    {editable ? <th scope="col">Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {rules === null ? (
                    <tr>
                      <td colSpan={editable ? 5 : 4} className="accounts-empty">
                        Reading the rulebook…
                      </td>
                    </tr>
                  ) : rules.length === 0 ? (
                    <tr>
                      <td colSpan={editable ? 5 : 4} className="accounts-empty">
                        No rules yet. Add one to categorize repeat descriptions on import.
                      </td>
                    </tr>
                  ) : (
                    rules.map((rule) => (
                      <tr key={rule.id}>
                        <td>
                          <span className="bank-rule-match">“{rule.descriptionContains}”</span>
                        </td>
                        <td>
                          {rule.targetAccount.code} · {rule.targetAccount.name}
                        </td>
                        <td className="num">{rule.priority}</td>
                        <td>
                          <span className={`status ${rule.active ? 'status--paid' : 'status--draft'}`}>
                            <span className="dot"></span>
                            {rule.active ? 'Active' : 'Paused'}
                          </span>
                        </td>
                        {editable ? (
                          <td>
                            <div className="bank-rule-actions">
                              <button
                                className="btn btn--outline btn--sm"
                                type="button"
                                onClick={() => openRuleForm(rule)}
                              >
                                Edit
                              </button>
                              <button
                                className="btn btn--ghost btn--sm"
                                type="button"
                                onClick={() => void onToggleRule(rule)}
                              >
                                {rule.active ? 'Pause' : 'Resume'}
                              </button>
                              <button
                                className="btn btn--ghost btn--sm bank-rule-delete"
                                type="button"
                                onClick={() => void onDeleteRule(rule)}
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <p className="accounts-note">
              Rules apply when a file is imported and post to the target account. Existing
              transactions are not rewritten when a rule changes.
            </p>
          </section>

          <section className="bank-transactions" aria-labelledby="bank-transactions-title">
            <div className="section-head">
              <div>
                <h2 id="bank-transactions-title">Activity</h2>
                <p className="section__meta">
                  {selected
                    ? `Showing ${selected.name} through the selected filters.`
                    : 'Choose a bank account to see its activity.'}
                </p>
              </div>
            </div>

            <div className="bank-filters">
              <label>
                <span>From</span>
                <input
                  type="date"
                  aria-label="Transactions from date"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                />
              </label>
              <label>
                <span>To</span>
                <input
                  type="date"
                  aria-label="Transactions to date"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                />
              </label>
              <label>
                <span>Match state</span>
                <select
                  aria-label="Filter transactions by match state"
                  value={matchFilter}
                  onChange={(event) =>
                    setMatchFilter(event.target.value as '' | BankTransactionMatchState)
                  }
                >
                  <option value="">All states</option>
                  {MATCH_STATES.map((state) => (
                    <option key={state.value} value={state.value}>
                      {state.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="bank-filters__search">
                <span>Search</span>
                <input
                  type="search"
                  aria-label="Search bank transactions"
                  placeholder="Description or memo"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
            </div>

            {error ? (
              <p className="members__error" role="alert">
                {error}
              </p>
            ) : null}

            <div className="table-scroll">
              <table className="data-table bank-transaction-table">
                <caption className="sr-only">Imported bank transactions with match state</caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Description</th>
                    <th scope="col">Category</th>
                    <th scope="col">Source</th>
                    <th scope="col" className="num">
                      Amount
                    </th>
                    <th scope="col">Match state</th>
                    {editable ? <th scope="col">Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {transactions === null ? (
                    <tr>
                      <td colSpan={editable ? 7 : 6} className="accounts-empty">
                        Turning the pages…
                      </td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={editable ? 7 : 6} className="accounts-empty">
                        No bank activity in this view.
                      </td>
                    </tr>
                  ) : (
                    rows.map((transaction) => (
                      <tr key={transaction.id}>
                        <td>{displayDate(transaction.date)}</td>
                        <td>{transaction.description}</td>
                        <td className="bank-category-cell">
                          {transaction.resolutionLabel ? (
                            <>
                              <span>{transaction.resolutionLabel}</span>
                              {transaction.categoryAccount &&
                              transaction.resolutionLabel !==
                                `${transaction.categoryAccount.code} ${transaction.categoryAccount.name}` ? (
                                <span className="bank-rule-sub">
                                  {transaction.categoryAccount.code} ·{' '}
                                  {transaction.categoryAccount.name}
                                </span>
                              ) : null}
                            </>
                          ) : transaction.categoryAccount ? (
                            <>
                              <span>
                                {transaction.categoryAccount.code} ·{' '}
                                {transaction.categoryAccount.name}
                              </span>
                              {transaction.categoryRule ? (
                                <span className="bank-rule-sub">
                                  Rule: {transaction.categoryRule.descriptionContains}
                                </span>
                              ) : null}
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="bank-source">
                          {transaction.importBatch.filename}
                          <span>{transaction.importBatch.format}</span>
                        </td>
                        <td
                          className={`num${
                            transaction.amount < 0 ? ' bank-amount-out' : ''
                          }`}
                        >
                          {signedMoney(transaction.amount)}
                        </td>
                        <td>
                          <span className={`status ${MATCH_CLASS[transaction.matchState]}`}>
                            <span className="dot"></span>
                            {transaction.matchState.charAt(0) +
                              transaction.matchState.slice(1).toLowerCase()}
                          </span>
                        </td>
                        {editable ? (
                          <td>
                            {transaction.matchState === 'UNMATCHED' &&
                            transaction.amount !== 0 ? (
                              <button
                                className="btn btn--outline btn--sm"
                                type="button"
                                aria-label={`Resolve ${transaction.description}`}
                                onClick={() => openResolve(transaction)}
                              >
                                Resolve
                              </button>
                            ) : (
                              <span className="bank-resolved-marker">—</span>
                            )}
                          </td>
                        ) : null}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      </div>

      <aside
        className={`margin side-drawer${accountFormOpen ? ' is-open' : ''}`}
        id="bank-account-form"
        aria-label="New bank account"
      >
        <div className="margin__head">
          <span className="members__mark" aria-hidden="true">
            <svg className="icon icon--sm" viewBox="0 0 24 24">
              <path d="M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6" />
            </svg>
          </span>
          <h2 className="margin__title">New bank account</h2>
          <button
            className="icon-btn margin__close"
            type="button"
            aria-label="Close bank account form"
            onClick={() => setAccountFormOpen(false)}
          >
            <svg className="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {accountError ? (
          <p className="members__error" role="alert">
            {accountError}
          </p>
        ) : null}

        <form className="drawer-form" onSubmit={(event) => void onAddAccount(event)}>
          <label className="drawer-form__label" htmlFor="bank-account-name">
            Account name
          </label>
          <input
            id="bank-account-name"
            required
            value={accountForm.name}
            onChange={(event) =>
              setAccountForm((current) => ({ ...current, name: event.target.value }))
            }
            placeholder="Operating checking"
          />

          <label className="drawer-form__label" htmlFor="bank-account-type">
            Type
          </label>
          <select
            id="bank-account-type"
            value={accountForm.type}
            onChange={(event) => setAccountType(event.target.value as BankAccountType)}
          >
            {ACCOUNT_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>

          <label className="drawer-form__label" htmlFor="bank-ledger-account">
            Ledger account
          </label>
          <select
            id="bank-ledger-account"
            required
            value={accountForm.ledgerAccountId}
            onChange={(event) =>
              setAccountForm((current) => ({ ...current, ledgerAccountId: event.target.value }))
            }
          >
            <option value="">Choose a ledger account</option>
            {eligibleLedgerAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.code} · {account.name}
              </option>
            ))}
          </select>
          <p className="drawer-form__hint">
            {accountForm.type === 'CREDIT_CARD'
              ? 'Credit cards link to a liability account.'
              : 'Bank accounts link to an asset account.'}
          </p>

          <div className="drawer-form__foot">
            <button className="btn btn--primary btn--sm" type="submit" disabled={accountBusy}>
              {accountBusy ? 'Adding…' : 'Add bank account'}
            </button>
          </div>
        </form>
      </aside>

      <aside
        className={`margin side-drawer${ruleFormOpen ? ' is-open' : ''}`}
        id="bank-rule-form"
        aria-label={ruleEditing ? 'Edit categorization rule' : 'New categorization rule'}
      >
        <div className="margin__head">
          <span className="members__mark" aria-hidden="true">
            <svg className="icon icon--sm" viewBox="0 0 24 24">
              <path d="M4 6h16M7 12h10M10 18h4" />
            </svg>
          </span>
          <h2 className="margin__title">
            {ruleEditing ? 'Edit categorization rule' : 'New categorization rule'}
          </h2>
          <button
            className="icon-btn margin__close"
            type="button"
            aria-label="Close categorization rule form"
            onClick={() => setRuleFormOpen(false)}
          >
            <svg className="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {ruleError ? (
          <p className="members__error" role="alert">
            {ruleError}
          </p>
        ) : null}

        <form className="drawer-form" id="rule-form" onSubmit={(event) => void onSaveRule(event)}>
          <label className="drawer-form__label" htmlFor="bank-rule-match">
            If description contains
          </label>
          <input
            id="bank-rule-match"
            required
            value={ruleForm.descriptionContains}
            onChange={(event) => setRuleField('descriptionContains', event.target.value)}
            placeholder="FUEL STOP"
          />
          <p className="drawer-form__hint">Matching ignores case and extra spaces.</p>

          <label className="drawer-form__label" htmlFor="bank-rule-target">
            Categorize as
          </label>
          <select
            id="bank-rule-target"
            required
            value={ruleForm.targetAccountId}
            onChange={(event) => setRuleField('targetAccountId', event.target.value)}
          >
            <option value="">Choose an account</option>
            {ledgerAccounts
              .filter(
                (account) => account.active || account.id === ruleForm.targetAccountId,
              )
              .map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} · {account.name}
                </option>
              ))}
          </select>

          <label className="drawer-form__label" htmlFor="bank-rule-priority">
            Priority
          </label>
          <input
            id="bank-rule-priority"
            type="number"
            min={0}
            max={1000}
            step={1}
            value={ruleForm.priority}
            onChange={(event) => setRuleField('priority', event.target.value)}
          />
          <p className="drawer-form__hint">
            Lower numbers run first. Equal priorities go to the older rule.
          </p>

          <label className="accounts-toggle accounts-toggle--drawer">
            <input
              type="checkbox"
              checked={ruleForm.active}
              onChange={(event) => setRuleField('active', event.target.checked)}
            />
            Rule is active
          </label>

          <div className="drawer-form__foot">
            <button className="btn btn--primary btn--sm" type="submit" disabled={ruleBusy}>
              {ruleBusy ? 'Saving…' : ruleEditing ? 'Save rule' : 'Add rule'}
            </button>
          </div>
        </form>
      </aside>

      <aside
        className={`margin side-drawer${resolveOpen ? ' is-open' : ''}`}
        id="bank-resolve-form"
        aria-label="Resolve transaction"
      >
        <div className="margin__head">
          <span className="members__mark" aria-hidden="true">
            <svg className="icon icon--sm" viewBox="0 0 24 24">
              <path d="M4 7h16M4 12h10M4 17h7" />
              <path d="m16 14 3 3 3-3" />
            </svg>
          </span>
          <h2 className="margin__title">Resolve transaction</h2>
          <button
            className="icon-btn margin__close"
            type="button"
            aria-label="Close transaction resolution"
            onClick={() => setResolveOpen(false)}
          >
            <svg className="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {resolveTransaction ? (
          <div className="bank-resolve-summary">
            <div>
              <span>{displayDate(resolveTransaction.date)}</span>
              <strong>{resolveTransaction.description}</strong>
            </div>
            <div className="bank-resolve-summary__amount">
              {signedMoney(resolveTransaction.amount)}
            </div>
            <div className="bank-resolve-summary__account">
              {resolveTransaction.bankAccount.name}
              {resolveSourceBank ? ` · ${resolveSourceBank.ledgerAccount.code} ${resolveSourceBank.ledgerAccount.name}` : ''}
            </div>
          </div>
        ) : null}

        {resolveError ? (
          <p className="members__error" role="alert">
            {resolveError}
          </p>
        ) : null}

        {resolveTransaction ? (
          <>
            <div className="bank-resolve-modes" role="tablist" aria-label="Resolution type">
              {resolveModes.map((mode) => (
                <button
                  key={mode}
                  className={`bank-resolve-mode${resolveMode === mode ? ' is-active' : ''}`}
                  type="button"
                  role="tab"
                  aria-selected={resolveMode === mode}
                  onClick={() => {
                    setResolveMode(mode);
                    setResolveError(null);
                  }}
                >
                  {RESOLVE_MODE_LABELS[mode]}
                </button>
              ))}
            </div>

            <form className="drawer-form" id="bank-resolve-form-body" onSubmit={(event) => void onResolveTransaction(event)}>
              {resolveMode === 'match' ? (
                <>
                  <div className="bank-match-head">
                    <span>Suggested matches</span>
                    {matchSuggestions && matchSuggestions.length > 0 ? (
                      <span className="bank-match-count">
                        {matchSuggestions.length} ranked
                      </span>
                    ) : null}
                  </div>

                  {matchLoading ? (
                    <p className="drawer-form__hint">Reading the books for close matches…</p>
                  ) : null}

                  {matchError ? (
                    <p className="members__error" role="alert">
                      {matchError}
                    </p>
                  ) : null}

                  {!matchLoading && !matchError && matchSuggestions?.length === 0 ? (
                    <p className="bank-match-empty">
                      No close matches. Categorize it, or create an expense or payment instead.
                    </p>
                  ) : null}

                  {matchSuggestions && matchSuggestions.length > 0 ? (
                    <div
                      className="bank-match-list"
                      role="radiogroup"
                      aria-label="Suggested matches"
                    >
                      {matchSuggestions.map((suggestion) => {
                        const key = `${suggestion.entityType}:${suggestion.entityId}`;
                        return (
                          <label
                            key={key}
                            className={`bank-match-card${
                              matchSelectedKey === key ? ' is-selected' : ''
                            }`}
                          >
                            <input
                              type="radio"
                              name="bank-match"
                              value={key}
                              checked={matchSelectedKey === key}
                              onChange={() => setMatchSelectedKey(key)}
                            />
                            <span className="bank-match-rank">{suggestion.rank}</span>
                            <span className="bank-match-body">
                              <span className="bank-match-kind">
                                {MATCH_TYPE_LABELS[suggestion.entityType]}
                              </span>
                              <span className="bank-match-title">{suggestion.label}</span>
                              <span className="bank-match-meta">
                                {displayDate(suggestion.date)} · {money(suggestion.amount)}
                              </span>
                              <span className="bank-match-reasons">
                                {suggestion.reasons.join(' · ')}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  ) : null}

                  <p className="drawer-form__hint">
                    Matching links this bank transaction to the record without posting another
                    journal.
                  </p>
                </>
              ) : null}

              {resolveMode === 'categorize' ? (
                <>
                  <label className="drawer-form__label" htmlFor="resolve-account">
                    Categorize as
                  </label>
                  <select
                    id="resolve-account"
                    required
                    value={resolveAccountId}
                    onChange={(event) => setResolveAccountId(event.target.value)}
                  >
                    <option value="">Choose an account</option>
                    {ledgerAccounts
                      .filter(
                        (account) =>
                          account.active && account.id !== resolveSourceBank?.ledgerAccountId,
                      )
                      .map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.code} · {account.name}
                        </option>
                      ))}
                  </select>
                  <p className="drawer-form__hint">
                    Posts one balanced journal: this bank account against the account you
                    choose.
                  </p>
                </>
              ) : null}

              {resolveMode === 'expense' ? (
                <>
                  <label className="drawer-form__label" htmlFor="resolve-category">
                    Expense category
                  </label>
                  <select
                    id="resolve-category"
                    required
                    value={resolveCategoryId}
                    onChange={(event) => setResolveCategoryId(event.target.value)}
                  >
                    <option value="">Choose an expense account</option>
                    {ledgerAccounts
                      .filter((account) => account.active && account.type === 'EXPENSE')
                      .map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.code} · {account.name}
                        </option>
                      ))}
                  </select>

                  <label className="drawer-form__label" htmlFor="resolve-vendor">
                    Vendor (optional)
                  </label>
                  <select
                    id="resolve-vendor"
                    value={resolveVendorId}
                    onChange={(event) => setResolveVendorId(event.target.value)}
                  >
                    <option value="">No vendor</option>
                    {vendors.map((vendor) => (
                      <option key={vendor.id} value={vendor.id}>
                        {vendor.code} · {vendor.name}
                      </option>
                    ))}
                  </select>

                  <label className="drawer-form__label" htmlFor="resolve-memo">
                    Memo
                  </label>
                  <input
                    id="resolve-memo"
                    value={resolveMemo}
                    onChange={(event) => setResolveMemo(event.target.value)}
                  />
                  <p className="drawer-form__hint">
                    Creates EXP-#### for {money(resolveAmount)} on {displayDate(resolveTransaction.date)} and posts it
                    from this bank account.
                  </p>
                </>
              ) : null}

              {resolveMode === 'payment' ? (
                <>
                  <label className="drawer-form__label" htmlFor="resolve-customer">
                    Customer
                  </label>
                  <select
                    id="resolve-customer"
                    required
                    value={resolveCustomerId}
                    onChange={(event) => {
                      setResolveCustomerId(event.target.value);
                      setResolveInvoiceId('');
                      setResolveInvoices([]);
                    }}
                  >
                    <option value="">Choose a customer</option>
                    {customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.code} · {customer.name}
                      </option>
                    ))}
                  </select>

                  <label className="drawer-form__label" htmlFor="resolve-invoice">
                    Open invoice
                  </label>
                  <select
                    id="resolve-invoice"
                    required
                    value={resolveInvoiceId}
                    onChange={(event) => setResolveInvoiceId(event.target.value)}
                    disabled={!resolveCustomerId || resolveInvoicesLoading}
                  >
                    <option value="">
                      {resolveInvoicesLoading
                        ? 'Reading open invoices…'
                        : resolveCustomerId
                          ? 'Choose an invoice'
                          : 'Choose a customer first'}
                    </option>
                    {resolveInvoices.map((invoice) => (
                      <option key={invoice.id} value={invoice.id}>
                        {invoice.number} · {money(invoice.balanceDue)} open
                      </option>
                    ))}
                  </select>

                  <div className="bank-resolve-amount">
                    <span>Payment amount</span>
                    <strong>{money(resolveAmount)}</strong>
                  </div>
                  {resolveCustomerId && !resolveInvoicesLoading && resolveInvoices.length === 0 ? (
                    <p className="drawer-form__hint">This customer has no open invoices.</p>
                  ) : null}
                  {selectedResolveInvoice && !paymentCoversBalance ? (
                    <p className="members__error" role="alert">
                      That invoice only has {money(selectedResolveInvoice.balanceDue)} open.
                    </p>
                  ) : null}
                  <p className="drawer-form__hint">
                    Records PAY-####, posts the bank deposit against receivables, and updates the
                    invoice.
                  </p>
                </>
              ) : null}

              {resolveMode === 'transfer' ? (
                <>
                  <label className="drawer-form__label" htmlFor="resolve-target-bank">
                    Transfer to
                  </label>
                  <select
                    id="resolve-target-bank"
                    required
                    value={resolveTargetBankId}
                    onChange={(event) => setResolveTargetBankId(event.target.value)}
                  >
                    <option value="">Choose another bank account</option>
                    {(accounts ?? [])
                      .filter(
                        (account) =>
                          account.active && account.id !== resolveTransaction.bankAccountId,
                      )
                      .map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name} · {account.ledgerAccount.code}{' '}
                          {account.ledgerAccount.name}
                        </option>
                      ))}
                  </select>
                  <p className="drawer-form__hint">
                    Moves {money(resolveAmount)} between the linked bank accounts and posts the
                    other side.
                  </p>
                </>
              ) : null}

              <div className="drawer-form__foot">
                <button
                  className="btn btn--primary btn--sm"
                  type="submit"
                  disabled={
                    resolveBusy ||
                    matchLoading ||
                    (resolveMode === 'match' && !matchSelectedKey) ||
                    (resolveMode === 'payment' &&
                      (!paymentCoversBalance || resolveInvoicesLoading))
                  }
                >
                  {resolveSubmitLabel}
                </button>
              </div>
            </form>
          </>
        ) : null}
      </aside>

      <aside
        className={`margin side-drawer${importOpen ? ' is-open' : ''}`}
        id="bank-import-form"
        aria-label="Import bank transactions"
      >
        <div className="margin__head">
          <span className="members__mark" aria-hidden="true">
            <svg className="icon icon--sm" viewBox="0 0 24 24">
              <path d="M12 3v12M7 10l5 5 5-5" />
              <path d="M4 17v3h16v-3" />
            </svg>
          </span>
          <h2 className="margin__title">Import transactions</h2>
          <button
            className="icon-btn margin__close"
            type="button"
            aria-label="Close import form"
            onClick={() => setImportOpen(false)}
          >
            <svg className="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="bank-import-account">
          <span>Into</span>
          <strong>{selected?.name ?? 'No account selected'}</strong>
          <span>{selected ? `${selected.ledgerAccount.code} · ${selected.ledgerAccount.name}` : ''}</span>
        </div>

        {importError ? (
          <p className="members__error" role="alert">
            {importError}
          </p>
        ) : null}

        <div className="drawer-form">
          <label className="drawer-form__label" htmlFor="bank-import-file">
            Bank file
          </label>
          <input
            id="bank-import-file"
            type="file"
            accept=".csv,.ofx,.qfx,text/csv,application/ofx"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              event.target.value = '';
              onImportFile(file);
            }}
          />
          <p className="drawer-form__hint">CSV or OFX, up to 10 MB.</p>

          {importFile ? (
            <button
              className="btn btn--outline btn--sm"
              type="button"
              onClick={() => void runPreview()}
              disabled={importBusy}
            >
              {importBusy ? 'Reading the file…' : 'Preview import'}
            </button>
          ) : null}

          {importPreview?.mapping ? (
            <div className="bank-mapping">
              <div className="bank-mapping__head">
                <h3>Map the columns</h3>
                <p>Choose which column holds each field, then preview again.</p>
              </div>
              <div className="bank-mapping__grid">
                <label>
                  <span>Date column</span>
                  <select
                    aria-label="Date column"
                    value={importMapping.dateColumn ?? ''}
                    onChange={(event) => setMapping('dateColumn', event.target.value)}
                  >
                    <option value="">Choose a column</option>
                    {importPreview.headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Description column</span>
                  <select
                    aria-label="Description column"
                    value={importMapping.descriptionColumn ?? ''}
                    onChange={(event) => setMapping('descriptionColumn', event.target.value)}
                  >
                    <option value="">Choose a column</option>
                    {importPreview.headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Amount column</span>
                  <select
                    aria-label="Amount column"
                    value={importMapping.amountColumn ?? ''}
                    onChange={(event) => setMapping('amountColumn', event.target.value)}
                  >
                    <option value="">Not mapped</option>
                    {importPreview.headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Debit column</span>
                  <select
                    aria-label="Debit column"
                    value={importMapping.debitColumn ?? ''}
                    onChange={(event) => setMapping('debitColumn', event.target.value)}
                  >
                    <option value="">Not mapped</option>
                    {importPreview.headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Credit column</span>
                  <select
                    aria-label="Credit column"
                    value={importMapping.creditColumn ?? ''}
                    onChange={(event) => setMapping('creditColumn', event.target.value)}
                  >
                    <option value="">Not mapped</option>
                    {importPreview.headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>External ID column</span>
                  <select
                    aria-label="External ID column"
                    value={importMapping.externalIdColumn ?? ''}
                    onChange={(event) => setMapping('externalIdColumn', event.target.value)}
                  >
                    <option value="">Not mapped</option>
                    {importPreview.headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <button
                className="btn btn--outline btn--sm"
                type="button"
                onClick={() => void runPreview()}
                disabled={importBusy}
              >
                {importBusy ? 'Reading the file…' : 'Refresh preview'}
              </button>
            </div>
          ) : null}

          {importPreview?.mappingError ? (
            <p className="members__error" role="alert">
              {importPreview.mappingError}
            </p>
          ) : null}

          {importPreview && !importPreview.mappingError ? (
            <div className="bank-import-preview" aria-label="Import preview">
              <div className="bank-preview-counts">
                <span>{importPreview.counts.newCount} new</span>
                <span>{importPreview.counts.duplicate} duplicate{importPreview.counts.duplicate === 1 ? '' : 's'}</span>
                <span>{importPreview.counts.invalid} invalid</span>
                <span>{previewRuleCount} categorized by rule</span>
              </div>
              <div className="bank-preview-scroll">
                <table className="bank-preview-table">
                  <caption className="sr-only">Normalized transaction preview</caption>
                  <thead>
                    <tr>
                      <th scope="col">Row</th>
                      <th scope="col">Date</th>
                      <th scope="col">Description</th>
                      <th scope="col">Categorizes as</th>
                      <th scope="col" className="num">
                        Amount
                      </th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importPreview.rows.map((row) => {
                      const status = previewStatus(row);
                      return (
                        <tr
                          key={row.rowNumber}
                          className={
                            status === 'Invalid'
                              ? 'is-invalid'
                              : status === 'Duplicate'
                                ? 'is-duplicate'
                                : undefined
                          }
                        >
                          <td>{row.rowNumber}</td>
                          <td>{row.date ? displayDate(row.date) : '—'}</td>
                          <td>
                            {row.description || '—'}
                            {row.error ? <span className="bank-row-error">{row.error}</span> : null}
                          </td>
                          <td className="bank-category-cell">
                            {row.rule ? (
                              <>
                                <span>
                                  {row.rule.targetAccount.code} · {row.rule.targetAccount.name}
                                </span>
                                <span className="bank-rule-sub">
                                  if “{row.rule.descriptionContains}”
                                </span>
                              </>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="num">{row.amount === null ? '—' : signedMoney(row.amount)}</td>
                          <td>
                            <span className="bank-preview-status">{status}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="bank-import-actions">
                <button
                  className="btn btn--primary btn--sm"
                  type="button"
                  onClick={() => void onConfirmImport()}
                  disabled={importBusy || importPreview.counts.valid === 0}
                >
                  {importBusy ? 'Importing…' : 'Import transactions'}
                </button>
                <span className="drawer-form__hint">
                  {importPreview.counts.newCount} new · {importPreview.counts.duplicate} already in
                  the book · {previewRuleCount} matched by rules
                </span>
              </div>
            </div>
          ) : null}
        </div>
      </aside>

      <div
        className={`scrim${accountFormOpen || ruleFormOpen || importOpen || resolveOpen ? ' is-visible' : ''}`}
        aria-hidden="true"
        onClick={() => {
          setAccountFormOpen(false);
          setRuleFormOpen(false);
          setImportOpen(false);
          setResolveOpen(false);
        }}
      />
      <div className={`toast${toast ? ' is-visible' : ''}`} role="status" aria-live="polite">
        {toast ?? ''}
      </div>
    </>
  );
}
