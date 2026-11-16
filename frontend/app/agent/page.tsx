'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppSpine } from '@/components/app-spine';
import {
  API_URL,
  ActiveOrganization,
  AgentAutomation,
  AgentDomainEventType,
  AgentJob,
  AgentJobStatus,
  AgentLogEntry,
  AgentModelOption,
  AgentPolicyMode,
  AgentPolicyView,
  AgentProposal,
  AgentProposalStatus,
  AgentTrigger,
  approveAgentProposal,
  clearSession,
  createAgentAutomation,
  deleteAgentAutomation,
  fetchActiveOrganization,
  fetchAgentApprovals,
  fetchAgentAutomations,
  fetchAgentJob,
  fetchAgentLogs,
  fetchAgentModels,
  fetchAgentPolicies,
  getAccessToken,
  getActiveOrgId,
  rejectAgentProposal,
  setActiveOrgId,
  submitAgentPrompt,
  updateAgentAutomation,
  updateAgentPolicy,
} from '@/lib/api';

type AgentTab = 'ask' | 'automations' | 'approvals' | 'policies' | 'activity';

type SlashCommandName = 'model' | 'cron' | 'event';

interface SlashCommand {
  name: SlashCommandName;
  label: string;
  description: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: 'model',
    label: 'Choose a model',
    description: 'Pick the allowlisted model for your next prompts in this session.',
  },
  {
    name: 'cron',
    label: 'Schedule a routine',
    description: 'Open the new-automation form preset to a schedule.',
  },
  {
    name: 'event',
    label: 'Automate on an event',
    description: 'Open the new-automation form preset to an event trigger.',
  },
];

const MODEL_LABELS: Record<string, string> = {
  flash: 'Flash',
  'flash-lite': 'Flash Lite',
  pro: 'Pro',
};

function modelLabel(alias: string | null | undefined, models: AgentModelOption[]): string | null {
  if (!alias) return null;
  return (
    models.find((entry) => entry.alias === alias)?.label ??
    MODEL_LABELS[alias] ??
    alias
  );
}

function slashOptionId(command: SlashCommand): string {
  return `agent-slash-option-${command.name}`;
}

interface AutomationFormState {
  name: string;
  prompt: string;
  mode: 'CRON' | 'EVENT';
  cron: string;
  timezone: string;
  preset: string;
  eventType: AgentDomainEventType;
  daysOverdue: string;
  minAmount: string;
  minDifference: string;
}

const EVENT_OPTIONS: Array<{ value: AgentDomainEventType; label: string }> = [
  { value: 'BANK_TRANSACTION_IMPORTED', label: 'A bank transaction is imported' },
  { value: 'INVOICE_OVERDUE', label: 'An invoice is overdue' },
  { value: 'BILL_OPENED', label: 'A bill opens' },
  { value: 'RECONCILIATION_DISCREPANCY', label: 'A reconciliation has a discrepancy' },
];

function eventTriggerLabel(form: AutomationFormState): string {
  switch (form.eventType) {
    case 'INVOICE_OVERDUE': {
      const days = Number.parseInt(form.daysOverdue || '0', 10) || 0;
      return days > 0
        ? `When an invoice is at least ${days} day${days === 1 ? '' : 's'} overdue`
        : 'When an invoice is overdue';
    }
    case 'BILL_OPENED': {
      const amount = Number.parseFloat(form.minAmount || '0') || 0;
      return amount > 0
        ? `When a bill opens above $${amount.toFixed(2)}`
        : 'When a bill opens';
    }
    case 'RECONCILIATION_DISCREPANCY': {
      const difference = Number.parseFloat(form.minDifference || '0') || 0;
      return difference > 0
        ? `When a reconciliation has a discrepancy of at least $${difference.toFixed(2)}`
        : 'When a reconciliation has a discrepancy';
    }
    default:
      return 'When a bank transaction is imported';
  }
}

function eventConfigFor(form: AutomationFormState): Record<string, number> {
  switch (form.eventType) {
    case 'INVOICE_OVERDUE':
      return { daysOverdue: Number.parseInt(form.daysOverdue || '0', 10) || 0 };
    case 'BILL_OPENED':
      return { minAmount: Number.parseFloat(form.minAmount || '0') || 0 };
    case 'RECONCILIATION_DISCREPANCY':
      return { minDifference: Number.parseFloat(form.minDifference || '0') || 0 };
    default:
      return {};
  }
}

const CRON_PRESETS = [
  { value: 'daily-9', label: 'Every day at 9:00', cron: '0 9 * * *' },
  { value: 'weekdays-9', label: 'Every weekday at 9:00', cron: '0 9 * * 1-5' },
  { value: 'monday-9', label: 'Every Monday at 9:00', cron: '0 9 * * 1' },
  { value: 'friday-17', label: 'Every Friday at 5:00 PM', cron: '0 17 * * 5' },
  { value: 'monthly-1', label: 'Monthly on the 1st at 9:00', cron: '0 9 1 * *' },
  { value: 'custom', label: 'Custom cron', cron: '' },
];

const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Karachi',
  'Asia/Tokyo',
  'Australia/Sydney',
];

const EMPTY_FORM: AutomationFormState = {
  name: '',
  prompt: '',
  mode: 'CRON',
  cron: '0 9 * * 1',
  timezone: 'UTC',
  preset: 'monday-9',
  eventType: 'BILL_OPENED',
  daysOverdue: '0',
  minAmount: '0',
  minDifference: '0',
};

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

function readableSchedule(cron: string): string {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return cron || 'Enter a five-field cron';
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  const numeric = (value: string) => /^\d+$/.test(value);
  if (!numeric(minute) || !numeric(hour)) return cron;
  const hourNumber = Number.parseInt(hour, 10);
  const suffix = hourNumber < 12 ? 'AM' : 'PM';
  const clock = `${hourNumber % 12 === 0 ? 12 : hourNumber % 12}:${String(
    Number.parseInt(minute, 10),
  ).padStart(2, '0')} ${suffix}`;
  if (month === '*' && dayOfMonth === '*') {
    if (dayOfWeek === '*') return `Every day at ${clock}`;
    if (dayOfWeek === '1-5') return `Every weekday at ${clock}`;
    if (numeric(dayOfWeek)) {
      return `Every ${WEEKDAYS[Number.parseInt(dayOfWeek, 10) % 7]} at ${clock}`;
    }
  }
  if (month === '*' && dayOfWeek === '*' && numeric(dayOfMonth)) {
    return `Monthly on the ${dayOfMonth} at ${clock}`;
  }
  return cron;
}

function presetFor(cron: string): string {
  return CRON_PRESETS.find((preset) => preset.cron === cron)?.value ?? 'custom';
}

function emptyForm(): AutomationFormState {
  return { ...EMPTY_FORM };
}
type ProposalFilter = 'PENDING' | 'ALL' | AgentProposalStatus;

interface Turn {
  id: string;
  role: 'user' | 'agent';
  text?: string;
  jobId?: string;
  logReference?: string;
}

const STATUS_LABEL: Record<AgentJobStatus, string> = {
  QUEUED: 'Queued',
  RUNNING: 'Running',
  RETRYING: 'Retrying',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
};

const TRIGGER_LABEL: Record<AgentTrigger, string> = {
  PROMPT: 'Prompt',
  CRON: 'Schedule',
  EVENT: 'Event',
};

const PROPOSAL_STATUS_LABEL: Record<AgentProposalStatus, string> = {
  PENDING: 'Pending',
  EXECUTING: 'Executing',
  EXECUTED: 'Executed',
  REJECTED: 'Rejected',
  FAILED: 'Failed',
};

function proposalStatusClass(status: AgentProposalStatus): string {
  if (status === 'EXECUTED') return 'status--paid';
  if (status === 'FAILED') return 'status--overdue';
  if (status === 'REJECTED') return 'status--draft';
  return 'status--amber';
}

function toolLabel(toolName: string): string {
  if (toolName === 'invoice.create') return 'Create draft invoice';
  return toolName;
}

function isWriteTool(toolName: string): boolean {
  return toolName === 'invoice.create';
}

function policyLabel(policy: AgentPolicyMode): string {
  return policy === 'auto' ? 'Auto-execute' : 'Requires approval';
}

function proposalConsequence(toolName: string): string {
  if (toolName === 'invoice.create') {
    return 'Approving creates one draft invoice under your permissions. Nothing posts to the ledger until the invoice is sent. Rejecting leaves the books unchanged.';
  }
  return 'Approving executes this action exactly once under your permissions. Rejecting leaves the books unchanged.';
}

function proposalInvoice(proposal: AgentProposal): { id: string; number?: string } | null {
  if (proposal.toolName !== 'invoice.create' || !proposal.result) return null;
  const result = proposal.result as { id?: unknown; number?: unknown };
  if (typeof result.id !== 'string') return null;
  return {
    id: result.id,
    number: typeof result.number === 'string' ? result.number : undefined,
  };
}

function statusClass(status: AgentJobStatus): string {
  if (status === 'COMPLETED') return 'status--paid';
  if (status === 'FAILED') return 'status--overdue';
  return 'status--amber';
}

function timeLabel(value: string): string {
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function busyCopy(job: AgentJob): string {
  if (job.status === 'RETRYING') {
    return `Agent is busy, retrying… (attempt ${job.attempts} of ${job.maxAttempts})`;
  }
  if (job.status === 'QUEUED') return 'Queued — the agent will start shortly.';
  return 'Reading the books…';
}

export default function AgentPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [org, setOrg] = useState<ActiveOrganization | null>(null);
  const [tab, setTab] = useState<AgentTab>('ask');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [prompt, setPrompt] = useState('');
  const [models, setModels] = useState<AgentModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
  const [slashActive, setSlashActive] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const [composerNotice, setComposerNotice] = useState<string | null>(null);
  const [focusAutomationName, setFocusAutomationName] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [job, setJob] = useState<AgentJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<AgentLogEntry[]>([]);
  const [logFilter, setLogFilter] = useState<'ALL' | AgentTrigger>('ALL');
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [selectedLog, setSelectedLog] = useState<AgentLogEntry | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [proposals, setProposals] = useState<AgentProposal[]>([]);
  const [proposalsLoading, setProposalsLoading] = useState(false);
  const [proposalsError, setProposalsError] = useState<string | null>(null);
  const [proposalFilter, setProposalFilter] = useState<ProposalFilter>('PENDING');
  const [pendingCount, setPendingCount] = useState(0);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [approvalNotice, setApprovalNotice] = useState<string | null>(null);
  const [lastDecision, setLastDecision] = useState<AgentProposal | null>(null);
  const [policies, setPolicies] = useState<AgentPolicyView[]>([]);
  const [policyDrafts, setPolicyDrafts] = useState<Record<string, AgentPolicyMode>>({});
  const [policiesLoading, setPoliciesLoading] = useState(false);
  const [policiesError, setPoliciesError] = useState<string | null>(null);
  const [policySaving, setPolicySaving] = useState<string | null>(null);
  const [policyNotice, setPolicyNotice] = useState<string | null>(null);
  const [automations, setAutomations] = useState<AgentAutomation[]>([]);
  const [automationsLoading, setAutomationsLoading] = useState(false);
  const [automationsError, setAutomationsError] = useState<string | null>(null);
  const [automationNotice, setAutomationNotice] = useState<string | null>(null);
  const [automationSaving, setAutomationSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [automationForm, setAutomationForm] = useState<AutomationFormState>(emptyForm);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);

  const canApprove = org?.role === 'OWNER' || org?.role === 'ADMIN';
  const canManageAutomations =
    org?.role === 'OWNER' ||
    org?.role === 'ADMIN' ||
    org?.role === 'ACCOUNTANT' ||
    org?.role === 'STAFF';
  const suggestions = useMemo(
    () => [
      "What's my cash position?",
      'Show me the profit and loss report',
      'Create a draft invoice for Northwind Studio for 1 Consulting hour at $150, due in 30 days.',
    ],
    [],
  );

  const slashQuery =
    prompt.startsWith('/') && !/\s/.test(prompt) ? prompt.slice(1).toLowerCase() : null;
  const slashMatches = useMemo(
    () =>
      slashQuery === null
        ? []
        : SLASH_COMMANDS.filter((command) => command.name.startsWith(slashQuery)),
    [slashQuery],
  );
  const slashMenuOpen = slashQuery !== null && !slashDismissed && !modelSelectorOpen;
  const defaultModelAlias = models.find((entry) => entry.default)?.alias ?? null;
  const activeModelAlias = selectedModel ?? defaultModelAlias;
  const activeModelLabel = modelLabel(activeModelAlias, models);

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
        session.memberships.find((membership) => membership.organizationId === stored) ??
        session.memberships[0];
      if (!initial) throw new Error('no organization');
      const activeOrg = await fetchActiveOrganization(initial.organizationId);
      if (cancelled) return;
      setActiveOrgId(activeOrg.organizationId);
      setOrg(activeOrg);
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

  useEffect(() => {
    if (!org || !activeJobId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const next = await fetchAgentJob(org.organizationId, activeJobId);
        if (cancelled) return;
        setJob(next);
        if (next.status === 'COMPLETED' || next.status === 'FAILED') {
          setActiveJobId(null);
        } else {
          timer = setTimeout(poll, 800);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'The agent job is not available');
        setActiveJobId(null);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [org, activeJobId]);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [turns, job]);

  useEffect(() => {
    if (!org || tab !== 'activity') return;
    let cancelled = false;
    setLogsLoading(true);
    const filters = logFilter === 'ALL' ? { limit: 50 } : { trigger: logFilter, limit: 50 };
    fetchAgentLogs(org.organizationId, filters)
      .then((rows) => {
        if (cancelled) return;
        setLogs(rows);
        setLogsError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setLogsError(err instanceof Error ? err.message : 'Agent activity is not available');
      })
      .finally(() => {
        if (!cancelled) setLogsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [org, tab, logFilter, job?.status, refreshToken]);

  useEffect(() => {
    if (!org) return;
    let cancelled = false;
    fetchAgentApprovals(org.organizationId, { status: 'PENDING', limit: 200 })
      .then((rows) => {
        if (!cancelled) setPendingCount(rows.length);
      })
      .catch(() => {
        // The count is advisory; the panel surfaces load errors.
      });
    return () => {
      cancelled = true;
    };
  }, [org, job?.status, refreshToken]);

  useEffect(() => {
    if (!org || tab !== 'approvals') return;
    let cancelled = false;
    setProposalsLoading(true);
    const filters =
      proposalFilter === 'ALL'
        ? { limit: 100 }
        : { status: proposalFilter, limit: 100 };
    fetchAgentApprovals(org.organizationId, filters)
      .then((rows) => {
        if (cancelled) return;
        setProposals(rows);
        setProposalsError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setProposalsError(
          err instanceof Error ? err.message : 'Agent approvals are not available',
        );
      })
      .finally(() => {
        if (!cancelled) setProposalsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [org, tab, proposalFilter, refreshToken, job?.status]);

  useEffect(() => {
    if (!org || tab !== 'policies') return;
    let cancelled = false;
    setPoliciesLoading(true);
    fetchAgentPolicies(org.organizationId)
      .then((rows) => {
        if (cancelled) return;
        setPolicies(rows);
        setPolicyDrafts(
          Object.fromEntries(rows.map((row) => [row.toolName, row.policy])),
        );
        setPoliciesError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setPoliciesError(
          err instanceof Error ? err.message : 'Agent policies are not available',
        );
      })
      .finally(() => {
        if (!cancelled) setPoliciesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [org, tab, refreshToken]);

  useEffect(() => {
    setSlashActive(0);
  }, [slashQuery]);

  useEffect(() => {
    if (!org) return;
    let cancelled = false;
    setModelsLoading(true);
    fetchAgentModels(org.organizationId)
      .then((catalog) => {
        if (cancelled) return;
        setModels(catalog.models);
        setSelectedModel((current) => current ?? catalog.defaultAlias);
        setModelsError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setModelsError(err instanceof Error ? err.message : 'Agent models are not available');
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [org]);

  useEffect(() => {
    if (!focusAutomationName || !formOpen || tab !== 'automations') return;
    document.getElementById('automation-name')?.focus();
    setFocusAutomationName(false);
  }, [focusAutomationName, formOpen, tab]);

  useEffect(() => {
    if (!org || tab !== 'automations') return;
    let cancelled = false;
    setAutomationsLoading(true);
    fetchAgentAutomations(org.organizationId)
      .then((rows) => {
        if (cancelled) return;
        setAutomations(rows);
        setAutomationsError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setAutomationsError(
          err instanceof Error ? err.message : 'Automations are not available',
        );
      })
      .finally(() => {
        if (!cancelled) setAutomationsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [org, tab, refreshToken]);

  async function savePolicy(row: AgentPolicyView) {
    if (!org || policySaving) return;
    const draft = policyDrafts[row.toolName] ?? row.policy;
    setPolicySaving(row.toolName);
    setPolicyNotice(null);
    try {
      const updated = await updateAgentPolicy(org.organizationId, row.toolName, draft);
      setPolicies((current) =>
        current.map((entry) => (entry.toolName === updated.toolName ? updated : entry)),
      );
      setPolicyDrafts((current) => ({ ...current, [updated.toolName]: updated.policy }));
      setPolicyNotice(
        `Saved. ${toolLabel(updated.toolName)} will ${
          updated.policy === 'auto' ? 'execute automatically' : 'wait for approval'
        } on the next run.`,
      );
    } catch (err) {
      setPoliciesError(err instanceof Error ? err.message : 'Could not save that policy');
    } finally {
      setPolicySaving(null);
    }
  }

  function openNewAutomation(mode: 'CRON' | 'EVENT' = 'CRON') {
    setAutomationForm({ ...emptyForm(), mode });
    setEditingId(null);
    setFormOpen(true);
    setConfirmDeleteId(null);
    setAutomationNotice(null);
    setAutomationsError(null);
  }

  function clearComposer() {
    setPrompt('');
    setSlashDismissed(true);
    setComposerNotice(null);
    setError(null);
  }

  function chooseSlashCommand(command: SlashCommand) {
    clearComposer();
    if (command.name === 'model') {
      setModelSelectorOpen(true);
      setComposerNotice(null);
      return;
    }
    if (!canManageAutomations) {
      setModelSelectorOpen(false);
      setComposerNotice(
        'Only an Owner, Admin, Accountant, or Staff member can create automations.',
      );
      promptRef.current?.focus();
      return;
    }
    setModelSelectorOpen(false);
    setTab('automations');
    openNewAutomation(command.name === 'event' ? 'EVENT' : 'CRON');
    setFocusAutomationName(true);
  }

  function chooseModel(alias: string) {
    const label = modelLabel(alias, models) ?? alias;
    setSelectedModel(alias);
    setModelSelectorOpen(false);
    setPrompt('');
    setSlashDismissed(true);
    setComposerNotice(
      `Model set to ${label}. New prompts use it; saved automations keep their own model.`,
    );
    promptRef.current?.focus();
  }

  function closeModelSelector() {
    setModelSelectorOpen(false);
    promptRef.current?.focus();
  }

  function rejectUnknownCommand() {
    setComposerNotice('Unknown command. Try /model, /cron, or /event.');
    setPrompt('');
    setSlashDismissed(true);
    promptRef.current?.focus();
  }

  function editAutomation(row: AgentAutomation) {
    setAutomationForm({
      name: row.name,
      prompt: row.prompt,
      mode: row.mode,
      cron: row.cron ?? '0 9 * * 1',
      timezone: row.timezone,
      preset: row.cron ? presetFor(row.cron) : 'custom',
      eventType: row.eventType ?? 'BILL_OPENED',
      daysOverdue: String(row.eventConfig?.daysOverdue ?? 0),
      minAmount: String(row.eventConfig?.minAmount ?? 0),
      minDifference: String(row.eventConfig?.minDifference ?? 0),
    });
    setEditingId(row.id);
    setFormOpen(true);
    setConfirmDeleteId(null);
    setAutomationNotice(null);
    setAutomationsError(null);
  }

  async function saveAutomation() {
    if (!org || automationSaving) return;
    setAutomationSaving(true);
    setAutomationsError(null);
    setAutomationNotice(null);
    const name = automationForm.name.trim();
    const prompt = automationForm.prompt.trim();
    try {
      if (editingId) {
        const updated =
          automationForm.mode === 'EVENT'
            ? await updateAgentAutomation(org.organizationId, editingId, {
                name,
                prompt,
                eventType: automationForm.eventType,
                eventConfig: eventConfigFor(automationForm),
              })
            : await updateAgentAutomation(org.organizationId, editingId, {
                name,
                prompt,
                cron: automationForm.cron.trim(),
                timezone: automationForm.timezone.trim() || 'UTC',
              });
        setAutomationNotice(`Saved “${updated.name}”. ${updated.scheduleLabel}.`);
      } else {
        const created =
          automationForm.mode === 'EVENT'
            ? await createAgentAutomation(org.organizationId, {
                name,
                prompt,
                mode: 'EVENT',
                eventType: automationForm.eventType,
                eventConfig: eventConfigFor(automationForm),
              })
            : await createAgentAutomation(org.organizationId, {
                name,
                prompt,
                mode: 'CRON',
                cron: automationForm.cron.trim(),
                timezone: automationForm.timezone.trim() || 'UTC',
              });
        setAutomationNotice(`Created “${created.name}”. ${created.scheduleLabel}.`);
      }
      setFormOpen(false);
      setEditingId(null);
      setAutomationForm(emptyForm());
      setRefreshToken((current) => current + 1);
    } catch (err) {
      setAutomationsError(
        err instanceof Error ? err.message : 'Could not save that automation',
      );
    } finally {
      setAutomationSaving(false);
    }
  }

  async function toggleAutomation(row: AgentAutomation) {
    if (!org || togglingId) return;
    setTogglingId(row.id);
    setAutomationsError(null);
    setAutomationNotice(null);
    try {
      const updated = await updateAgentAutomation(org.organizationId, row.id, {
        enabled: !row.enabled,
      });
      setAutomations((current) =>
        current.map((entry) => (entry.id === updated.id ? updated : entry)),
      );
      setAutomationNotice(
        updated.enabled
          ? `Resumed “${updated.name}”.`
          : `Paused “${updated.name}”. No runs will start until resumed.`,
      );
      setRefreshToken((current) => current + 1);
    } catch (err) {
      setAutomationsError(
        err instanceof Error ? err.message : 'Could not change that automation',
      );
    } finally {
      setTogglingId(null);
    }
  }

  async function removeAutomation(row: AgentAutomation) {
    if (!org) return;
    setAutomationsError(null);
    setAutomationNotice(null);
    try {
      await deleteAgentAutomation(org.organizationId, row.id);
      setAutomations((current) => current.filter((entry) => entry.id !== row.id));
      setConfirmDeleteId(null);
      setAutomationNotice(`Deleted “${row.name}”. It will not run again.`);
      setRefreshToken((current) => current + 1);
    } catch (err) {
      setAutomationsError(
        err instanceof Error ? err.message : 'Could not delete that automation',
      );
    }
  }

  async function send() {
    const text = prompt.trim();
    if (!text || !org || submitting || activeJobId) return;
    if (text.startsWith('/')) {
      const name = text.replace(/^\//, '').trim().split(/\s+/)[0]?.toLowerCase();
      const command = SLASH_COMMANDS.find((entry) => entry.name === name);
      if (command) {
        chooseSlashCommand(command);
      } else {
        rejectUnknownCommand();
      }
      return;
    }
    setSubmitting(true);
    setError(null);
    setComposerNotice(null);
    const id = `${Date.now()}`;
    setTurns((current) => [...current, { id, role: 'user', text }]);
    setPrompt('');
    try {
      const submission = await submitAgentPrompt(
        org.organizationId,
        text,
        selectedModel ?? undefined,
      );
      setTurns((current) => [
        ...current,
        {
          id: `${id}-agent`,
          role: 'agent',
          jobId: submission.jobId,
          logReference: submission.logReference,
        },
      ]);
      setJob(null);
      setActiveJobId(submission.jobId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not send that prompt';
      setError(message);
      setTurns((current) => [...current, { id: `${id}-agent`, role: 'agent', text: message }]);
    } finally {
      setSubmitting(false);
    }
  }

  function openActivity() {
    setTab('activity');
  }

  function openApprovals() {
    setTab('approvals');
  }

  async function decide(proposal: AgentProposal, action: 'approve' | 'reject') {
    if (!org || decidingId) return;
    setDecidingId(proposal.id);
    setApprovalNotice(null);
    try {
      const decided =
        action === 'approve'
          ? await approveAgentProposal(org.organizationId, proposal.id)
          : await rejectAgentProposal(org.organizationId, proposal.id);
      setLastDecision(decided);
      setApprovalNotice(
        action === 'approve'
          ? decided.status === 'EXECUTED'
            ? 'Approved. Clerk executed the action once.'
            : 'Approved, but execution failed. No books were changed by a failed action.'
          : 'Rejected. No books were changed.',
      );
      setRefreshToken((current) => current + 1);
    } catch (err) {
      setApprovalNotice(
        err instanceof Error ? err.message : 'Could not record that decision',
      );
    } finally {
      setDecidingId(null);
    }
  }

  if (!ready) {
    return (
      <main className="app-loading">
        <p className="app-loading__hint">Opening Clerk’s desk…</p>
      </main>
    );
  }

  return (
    <div className="app-shell app-shell--accounts">
      <AppSpine active="agent" org={org} />

      <main className="page" id="main">
        <header className="page-head">
          <div>
            <h1>Clerk</h1>
            <p className="page-head__meta">
              Works in {org?.organizationName}. Reads run now with your permissions; write actions
              follow this organization’s approval policy.
            </p>
          </div>
          <div className="page-head__actions">
            <a className="btn btn--ghost btn--sm" href="/reports">
              Open reports
            </a>
          </div>
        </header>

        <div className="tabs agent-tabs" role="tablist" aria-label="Clerk workspace">
          <button
            className="tab"
            type="button"
            role="tab"
            aria-selected={tab === 'ask'}
            id="agent-tab-ask"
            aria-controls="agent-panel-ask"
            onClick={() => setTab('ask')}
          >
            Ask
          </button>
          <button
            className="tab"
            type="button"
            role="tab"
            aria-selected={tab === 'automations'}
            id="agent-tab-automations"
            aria-controls="agent-panel-automations"
            onClick={() => setTab('automations')}
          >
            Automations
          </button>
          <button
            className="tab"
            type="button"
            role="tab"
            aria-selected={tab === 'approvals'}
            id="agent-tab-approvals"
            aria-controls="agent-panel-approvals"
            onClick={openApprovals}
          >
            Approvals
            {pendingCount > 0 ? (
              <span className="tab__count" aria-label={`${pendingCount} pending`}>
                {pendingCount}
              </span>
            ) : null}
          </button>
          {canApprove ? (
            <button
              className="tab"
              type="button"
              role="tab"
              aria-selected={tab === 'policies'}
              id="agent-tab-policies"
              aria-controls="agent-panel-policies"
              onClick={() => setTab('policies')}
            >
              Policies
            </button>
          ) : null}
          <button
            className="tab"
            type="button"
            role="tab"
            aria-selected={tab === 'activity'}
            id="agent-tab-activity"
            aria-controls="agent-panel-activity"
            onClick={openActivity}
          >
            Activity
          </button>
        </div>

        <section
          className="agent-panel"
          id="agent-panel-ask"
          role="tabpanel"
          aria-labelledby="agent-tab-ask"
          hidden={tab !== 'ask'}
        >
          <div className="chat">
            <div
              className="transcript"
              ref={transcriptRef}
              role="log"
              aria-live="polite"
              aria-relevant="additions text"
              aria-label="Conversation with the clerk"
            >
              {turns.length === 0 ? (
                <p className="empty-state">
                  Ask a question about this organization’s books, or ask Clerk to draft an
                  invoice. Reads run now; write actions follow the organization’s policy.
                </p>
              ) : null}
              {turns.map((turn) =>
                turn.role === 'user' ? (
                  <div className="msg msg--user" key={turn.id}>
                    <div className="msg__body">
                      <span className="sr-only">You: </span>
                      {turn.text}
                    </div>
                  </div>
                ) : (
                  <div className="msg msg--clerk" key={turn.id}>
                    <div className="msg__icon" aria-hidden="true">
                      <svg className="icon icon--sm" viewBox="0 0 24 24">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                      </svg>
                    </div>
                    <div className="msg__body">
                      <span className="sr-only">Clerk: </span>
                      <span className="msg__name">Clerk</span>
                      {turn.jobId ? (
                        <AgentJobReply
                          job={job && job.jobId === turn.jobId ? job : null}
                          fallbackRef={turn.logReference}
                          onOpenActivity={openActivity}
                          onOpenApprovals={openApprovals}
                        />
                      ) : (
                        <div>{turn.text}</div>
                      )}
                    </div>
                  </div>
                ),
              )}
            </div>

            <form
              className="composer"
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              <div className="composer__box">
                <label className="sr-only" htmlFor="agent-prompt">
                  Ask the clerk to do something
                </label>
                <textarea
                  id="agent-prompt"
                  ref={promptRef}
                  rows={1}
                  value={prompt}
                  placeholder="Ask a question or describe an action"
                  aria-controls={slashMenuOpen ? 'agent-slash-menu' : undefined}
                  aria-expanded={slashMenuOpen}
                  aria-activedescendant={
                    slashMenuOpen && slashMatches.length > 0
                      ? slashOptionId(
                          slashMatches[Math.min(slashActive, slashMatches.length - 1)],
                        )
                      : undefined
                  }
                  onChange={(event) => {
                    setPrompt(event.target.value);
                    setSlashDismissed(false);
                    setComposerNotice(null);
                  }}
                  onKeyDown={(event) => {
                    if (modelSelectorOpen && event.key === 'Escape') {
                      event.preventDefault();
                      closeModelSelector();
                      return;
                    }
                    if (slashMenuOpen) {
                      if (event.key === 'ArrowDown') {
                        event.preventDefault();
                        if (slashMatches.length > 0) {
                          setSlashActive((current) => (current + 1) % slashMatches.length);
                        }
                        return;
                      }
                      if (event.key === 'ArrowUp') {
                        event.preventDefault();
                        if (slashMatches.length > 0) {
                          setSlashActive((current) =>
                            (current - 1 + slashMatches.length) % slashMatches.length,
                          );
                        }
                        return;
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        setSlashDismissed(true);
                        return;
                      }
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        if (slashMatches.length > 0) {
                          chooseSlashCommand(
                            slashMatches[Math.min(slashActive, slashMatches.length - 1)],
                          );
                        } else {
                          rejectUnknownCommand();
                        }
                        return;
                      }
                    }
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                />
                <button
                  className="btn btn--primary"
                  type="submit"
                  disabled={submitting || activeJobId !== null || prompt.trim().length === 0}
                >
                  {submitting ? 'Sending…' : 'Send'}
                </button>
                {slashMenuOpen ? (
                  <div
                    className="slash-menu"
                    id="agent-slash-menu"
                    role="listbox"
                    aria-label="Slash commands"
                  >
                    {slashMatches.length === 0 ? (
                      <p className="slash-menu__empty" role="status">
                        No commands match.
                      </p>
                    ) : (
                      slashMatches.map((command, index) => (
                        <div
                          key={command.name}
                          id={slashOptionId(command)}
                          className={`slash-menu__item${
                            index === slashActive ? ' is-active' : ''
                          }`}
                          role="option"
                          aria-selected={index === slashActive}
                          onMouseDown={(event) => event.preventDefault()}
                          onMouseEnter={() => setSlashActive(index)}
                          onClick={() => chooseSlashCommand(command)}
                        >
                          <span className="slash-menu__cmd">/{command.name}</span>
                          <span className="slash-menu__copy">
                            <span className="slash-menu__label">{command.label}</span>
                            <span className="slash-menu__desc">{command.description}</span>
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
              {modelSelectorOpen ? (
                <div
                  className="model-selector"
                  role="dialog"
                  aria-label="Choose a model"
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      closeModelSelector();
                    }
                  }}
                >
                  <div className="model-selector__head">
                    <div>
                      <p className="model-selector__title">Choose a model</p>
                      <p className="dialog__note">
                        Applies to new prompts in this session only. Saved automations keep
                        their own model.
                      </p>
                    </div>
                    <button
                      className="btn btn--ghost btn--sm"
                      type="button"
                      onClick={closeModelSelector}
                    >
                      Close
                    </button>
                  </div>
                  {modelsError ? (
                    <p className="members__error" role="alert">
                      {modelsError}
                    </p>
                  ) : null}
                  {modelsLoading && models.length === 0 ? (
                    <p className="muted">Reading models…</p>
                  ) : (
                    <div
                      className="model-options"
                      role="radiogroup"
                      aria-label="Allowlisted models"
                    >
                      {models.map((model) => (
                        <label className="model-option" key={model.alias}>
                          <input
                            type="radio"
                            name="agent-model"
                            value={model.alias}
                            checked={activeModelAlias === model.alias}
                            onChange={() => chooseModel(model.alias)}
                          />
                          <span className="model-option__copy">
                            <span className="model-option__title">
                              {model.label}
                              {model.default ? ' · Default' : ''}
                            </span>
                            <span className="model-option__meta">
                              {model.alias} · {model.modelId}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
              <div className="suggestions">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => setPrompt(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
                <span className="suggestions__meta">
                  {activeModelLabel ? `Model: ${activeModelLabel} · ` : ''}
                  Reads run now · writes follow policy
                </span>
              </div>
              {composerNotice ? (
                <p className="approval__notice composer__notice" role="status">
                  {composerNotice}
                </p>
              ) : null}
              {error ? (
                <p className="members__error" role="alert">
                  {error}
                </p>
              ) : null}
            </form>
          </div>
        </section>

        <section
          className="agent-panel"
          id="agent-panel-automations"
          role="tabpanel"
          aria-labelledby="agent-tab-automations"
          hidden={tab !== 'automations'}
        >
          <div className="section__head">
            <h2 className="section__title">Automations</h2>
            <span className="section__meta">
              Scheduled routines run as Clerk with their creator’s permissions. Every run is
              logged.
            </span>
          </div>

          {automationNotice ? (
            <p className="approval__notice" role="status" aria-live="polite">
              {automationNotice}
            </p>
          ) : null}
          {automationsError ? (
            <p className="members__error" role="alert">
              {automationsError}
            </p>
          ) : null}

          <div className="automation-toolbar">
            <p className="section__meta">
              {canManageAutomations
                ? 'Runs happen when each trigger fires. Edits apply to the next run.'
                : 'Read-only — an Owner, Admin, Accountant, or Staff member can change automations.'}
            </p>
            {canManageAutomations ? (
              <button
                className="btn btn--primary btn--sm"
                type="button"
                onClick={() => openNewAutomation()}
              >
                New automation
              </button>
            ) : null}
          </div>

          {formOpen && canManageAutomations ? (
            <form
              className="automation-form"
              onSubmit={(event) => {
                event.preventDefault();
                void saveAutomation();
              }}
            >
              <div className="automation-form__grid">
                <div className="field">
                  <label htmlFor="automation-name">Name</label>
                  <input
                    id="automation-name"
                    value={automationForm.name}
                    maxLength={120}
                    placeholder="Weekly cash review"
                    onChange={(event) =>
                      setAutomationForm((current) => ({ ...current, name: event.target.value }))
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor="automation-mode">Trigger</label>
                  <select
                    id="automation-mode"
                    value={automationForm.mode}
                    disabled={Boolean(editingId)}
                    onChange={(event) =>
                      setAutomationForm((current) => ({
                        ...current,
                        mode: event.target.value as 'CRON' | 'EVENT',
                      }))
                    }
                  >
                    <option value="CRON">Schedule</option>
                    <option value="EVENT">Event</option>
                  </select>
                </div>
                {automationForm.mode === 'CRON' ? (
                  <>
                    <div className="field">
                      <label htmlFor="automation-preset">Schedule preset</label>
                      <select
                        id="automation-preset"
                        value={automationForm.preset}
                        onChange={(event) => {
                          const preset = CRON_PRESETS.find(
                            (entry) => entry.value === event.target.value,
                          );
                          setAutomationForm((current) => ({
                            ...current,
                            preset: event.target.value,
                            cron:
                              preset && preset.value !== 'custom'
                                ? preset.cron
                                : current.cron,
                          }));
                        }}
                      >
                        {CRON_PRESETS.map((preset) => (
                          <option key={preset.value} value={preset.value}>
                            {preset.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="automation-cron">Cron (five fields)</label>
                      <input
                        id="automation-cron"
                        value={automationForm.cron}
                        maxLength={200}
                        placeholder="0 9 * * 1"
                        onChange={(event) =>
                          setAutomationForm((current) => ({
                            ...current,
                            cron: event.target.value,
                            preset: presetFor(event.target.value),
                          }))
                        }
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="automation-timezone">Timezone</label>
                      <input
                        id="automation-timezone"
                        value={automationForm.timezone}
                        maxLength={100}
                        list="automation-timezones"
                        placeholder="UTC"
                        onChange={(event) =>
                          setAutomationForm((current) => ({
                            ...current,
                            timezone: event.target.value,
                          }))
                        }
                      />
                      <datalist id="automation-timezones">
                        {COMMON_TIMEZONES.map((zone) => (
                          <option key={zone} value={zone} />
                        ))}
                      </datalist>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="field">
                      <label htmlFor="automation-event-type">Event</label>
                      <select
                        id="automation-event-type"
                        value={automationForm.eventType}
                        onChange={(event) =>
                          setAutomationForm((current) => ({
                            ...current,
                            eventType: event.target.value as AgentDomainEventType,
                          }))
                        }
                      >
                        {EVENT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    {automationForm.eventType === 'INVOICE_OVERDUE' ? (
                      <div className="field">
                        <label htmlFor="automation-days-overdue">
                          Minimum days overdue
                        </label>
                        <input
                          id="automation-days-overdue"
                          type="number"
                          min={0}
                          step={1}
                          value={automationForm.daysOverdue}
                          onChange={(event) =>
                            setAutomationForm((current) => ({
                              ...current,
                              daysOverdue: event.target.value,
                            }))
                          }
                        />
                      </div>
                    ) : null}
                    {automationForm.eventType === 'BILL_OPENED' ? (
                      <div className="field">
                        <label htmlFor="automation-min-amount">Minimum amount</label>
                        <input
                          id="automation-min-amount"
                          type="number"
                          min={0}
                          step="0.01"
                          value={automationForm.minAmount}
                          onChange={(event) =>
                            setAutomationForm((current) => ({
                              ...current,
                              minAmount: event.target.value,
                            }))
                          }
                        />
                      </div>
                    ) : null}
                    {automationForm.eventType === 'RECONCILIATION_DISCREPANCY' ? (
                      <div className="field">
                        <label htmlFor="automation-min-difference">
                          Minimum difference
                        </label>
                        <input
                          id="automation-min-difference"
                          type="number"
                          min={0}
                          step="0.01"
                          value={automationForm.minDifference}
                          onChange={(event) =>
                            setAutomationForm((current) => ({
                              ...current,
                              minDifference: event.target.value,
                            }))
                          }
                        />
                      </div>
                    ) : null}
                    {automationForm.eventType === 'BANK_TRANSACTION_IMPORTED' ? (
                      <p className="automation-form__note">
                        Runs once for every imported bank transaction, after the import
                        commits.
                      </p>
                    ) : null}
                  </>
                )}
                <div className="field automation-form__prompt">
                  <label htmlFor="automation-prompt">Prompt</label>
                  <textarea
                    id="automation-prompt"
                    rows={3}
                    maxLength={2000}
                    placeholder="Review the event and flag anything unusual."
                    value={automationForm.prompt}
                    onChange={(event) =>
                      setAutomationForm((current) => ({
                        ...current,
                        prompt: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <p className="automation-form__preview" aria-live="polite">
                {automationForm.mode === 'EVENT'
                  ? `Runs ${eventTriggerLabel(automationForm)}`
                  : `Runs ${readableSchedule(automationForm.cron)} · ${
                      automationForm.timezone.trim() || 'UTC'
                    }`}
              </p>
              <div className="automation-form__actions">
                <button
                  className="btn btn--primary btn--sm"
                  type="submit"
                  disabled={
                    automationSaving ||
                    !automationForm.name.trim() ||
                    !automationForm.prompt.trim() ||
                    (automationForm.mode === 'CRON' &&
                      !automationForm.cron.trim())
                  }
                >
                  {automationSaving
                    ? 'Saving…'
                    : editingId
                      ? 'Save automation'
                      : 'Create automation'}
                </button>
                <button
                  className="btn btn--outline btn--sm"
                  type="button"
                  onClick={() => {
                    setFormOpen(false);
                    setEditingId(null);
                    setAutomationForm(emptyForm());
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : null}

          <div className="table-scroll">
            <table className="data-table automation-table">
              <caption className="sr-only">Automations</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Trigger</th>
                  <th scope="col">Prompt</th>
                  <th scope="col">Enabled</th>
                  <th scope="col">Last run</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {automations.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="empty-state">
                      {automationsLoading
                        ? 'Reading automations…'
                        : 'No automations yet. A scheduled or event routine runs Clerk and logs every run.'}
                    </td>
                  </tr>
                ) : (
                  automations.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <div className="policy-action">
                          <span className="policy-action__name">{row.name}</span>
                          <span className="policy-action__tool">
                            {row.createdBy ? `by ${row.createdBy.name}` : 'Clerk'}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div>{row.scheduleLabel}</div>
                        <span className="muted">
                          {row.mode === 'EVENT'
                            ? row.enabled
                              ? 'Event trigger'
                              : 'Event trigger · paused'
                            : `${row.timezone}${
                                row.enabled && row.nextRunAt
                                  ? ` · next ${timeLabel(row.nextRunAt)}`
                                  : row.enabled
                                    ? ''
                                    : ' · paused'
                              }`}
                        </span>
                      </td>
                      <td className="automation-prompt">{row.prompt}</td>
                      <td>
                        <label className="automation-toggle">
                          <input
                            type="checkbox"
                            role="switch"
                            aria-label={`Enable ${row.name}`}
                            checked={row.enabled}
                            disabled={!canManageAutomations || togglingId === row.id}
                            onChange={() => void toggleAutomation(row)}
                          />
                          <span>{row.enabled ? 'Enabled' : 'Paused'}</span>
                        </label>
                      </td>
                      <td>
                        {row.lastRunAt ? (
                          <div className="automation-last">
                            <span
                              className={`status ${
                                row.lastStatus ? statusClass(row.lastStatus) : 'status--draft'
                              }`}
                            >
                              <span className="dot" />
                              {row.lastStatus ? STATUS_LABEL[row.lastStatus] : 'Queued'}
                            </span>
                            <span className="muted">{timeLabel(row.lastRunAt)}</span>
                            {row.lastLogReference ? (
                              <button
                                className="link agent-log-ref"
                                type="button"
                                onClick={() => {
                                  setLogFilter(row.mode === 'EVENT' ? 'EVENT' : 'CRON');
                                  setTab('activity');
                                }}
                              >
                                {row.lastLogReference}
                              </button>
                            ) : null}
                          </div>
                        ) : (
                          <span className="muted">Not yet run</span>
                        )}
                      </td>
                      <td>
                        {canManageAutomations ? (
                          confirmDeleteId === row.id ? (
                            <div className="row-actions">
                              <button
                                className="btn btn--danger btn--sm"
                                type="button"
                                onClick={() => void removeAutomation(row)}
                              >
                                Delete schedule
                              </button>
                              <button
                                className="btn btn--outline btn--sm"
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="row-actions">
                              <button
                                className="btn btn--outline btn--sm"
                                type="button"
                                onClick={() => editAutomation(row)}
                              >
                                Edit
                              </button>
                              <button
                                className="btn btn--ghost btn--sm"
                                type="button"
                                onClick={() => setConfirmDeleteId(row.id)}
                              >
                                Delete
                              </button>
                            </div>
                          )
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section
          className="agent-panel"
          id="agent-panel-approvals"
          role="tabpanel"
          aria-labelledby="agent-tab-approvals"
          hidden={tab !== 'approvals'}
        >
          <div className="section__head">
            <h2 className="section__title">Approvals</h2>
            <span className="section__meta">
              Owner and Admin approve write actions. Nothing runs until approved.
            </span>
          </div>

          {approvalNotice ? (
            <p className="approval__notice" role="status" aria-live="polite">
              {approvalNotice}
            </p>
          ) : null}
          {proposalsError ? (
            <p className="members__error" role="alert">
              {proposalsError}
            </p>
          ) : null}

          {lastDecision ? (
            <ProposalCard
              proposal={lastDecision}
              canApprove={false}
              deciding={false}
              heading="Latest decision"
              onDecide={decide}
            />
          ) : null}

          <div className="activity-toolbar">
            <label className="section__meta" htmlFor="agent-approval-filter">
              Status
            </label>
            <select
              className="select"
              id="agent-approval-filter"
              value={proposalFilter}
              onChange={(event) => setProposalFilter(event.target.value as ProposalFilter)}
            >
              <option value="PENDING">Pending</option>
              <option value="ALL">All</option>
              <option value="EXECUTED">Executed</option>
              <option value="REJECTED">Rejected</option>
              <option value="FAILED">Failed</option>
            </select>
            <button
              className="btn btn--outline btn--sm"
              type="button"
              onClick={() => setRefreshToken((current) => current + 1)}
            >
              Refresh
            </button>
          </div>

          <div className="approval-list">
            {proposals.length === 0 ? (
              <p className="empty-state">
                {proposalsLoading
                  ? 'Reading approvals…'
                  : proposalFilter === 'PENDING'
                    ? 'No pending proposals. Write actions Clerk proposes will appear here.'
                    : 'No proposals match this filter.'}
              </p>
            ) : (
              proposals.map((proposal) => (
                <ProposalCard
                  key={proposal.id}
                  proposal={proposal}
                  canApprove={canApprove}
                  deciding={decidingId === proposal.id}
                  onDecide={decide}
                />
              ))
            )}
          </div>
        </section>

        <section
          className="agent-panel"
          id="agent-panel-policies"
          role="tabpanel"
          aria-labelledby="agent-tab-policies"
          hidden={tab !== 'policies'}
        >
          <div className="section__head">
            <h2 className="section__title">Policies</h2>
            <span className="section__meta">
              Choose whether Clerk runs each action now or waits for approval.
            </span>
          </div>

          <p className="policy-warning" role="note">
            <strong>Auto-execute creates records without review.</strong> That includes
            financial actions such as draft invoices. Sensitive actions default to approval.
            Every change applies to the next run immediately and is recorded in the audit log.
          </p>

          {policyNotice ? (
            <p className="approval__notice" role="status" aria-live="polite">
              {policyNotice}
            </p>
          ) : null}
          {policiesError ? (
            <p className="members__error" role="alert">
              {policiesError}
            </p>
          ) : null}

          <div className="table-scroll">
            <table className="data-table policy-table">
              <caption className="sr-only">Agent action policies</caption>
              <thead>
                <tr>
                  <th scope="col">Action</th>
                  <th scope="col">Access</th>
                  <th scope="col">Default</th>
                  <th scope="col">Current policy</th>
                  <th scope="col">Updated</th>
                  <th scope="col">
                    <span className="sr-only">Save</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {policies.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="empty-state">
                      {policiesLoading ? 'Reading policies…' : 'No agent actions registered.'}
                    </td>
                  </tr>
                ) : (
                  policies.map((row) => {
                    const draft = policyDrafts[row.toolName] ?? row.policy;
                    const changed = row.configurable && draft !== row.policy;
                    const saving = policySaving === row.toolName;
                    return (
                      <tr key={row.toolName}>
                        <td>
                          <div className="policy-action">
                            <span className="policy-action__name">{toolLabel(row.toolName)}</span>
                            <span className="policy-action__tool">{row.toolName}</span>
                          </div>
                        </td>
                        <td>
                          {row.readOnly ? (
                            'Read-only'
                          ) : row.sensitive ? (
                            <span className="status status--amber">
                              <span className="dot" />
                              Sensitive write
                            </span>
                          ) : (
                            'Write'
                          )}
                        </td>
                        <td>{policyLabel(row.defaultPolicy)}</td>
                        <td>
                          {row.configurable ? (
                            <select
                              className="select"
                              aria-label={`Policy for ${toolLabel(row.toolName)}`}
                              value={draft}
                              onChange={(event) =>
                                setPolicyDrafts((current) => ({
                                  ...current,
                                  [row.toolName]: event.target.value as AgentPolicyMode,
                                }))
                              }
                            >
                              <option value="approve">Requires approval</option>
                              <option value="auto">Auto-execute</option>
                            </select>
                          ) : (
                            <span className="muted">Auto-execute (locked)</span>
                          )}
                        </td>
                        <td>
                          {row.updatedAt
                            ? `${timeLabel(row.updatedAt)}${
                                row.updatedBy ? ` · ${row.updatedBy.name}` : ''
                              }`
                            : 'Default'}
                        </td>
                        <td>
                          {row.configurable ? (
                            <button
                              className="btn btn--outline btn--sm"
                              type="button"
                              disabled={!changed || saving}
                              onClick={() => void savePolicy(row)}
                            >
                              {saving ? 'Saving…' : 'Save'}
                            </button>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section
          className="agent-panel"
          id="agent-panel-activity"
          role="tabpanel"
          aria-labelledby="agent-tab-activity"
          hidden={tab !== 'activity'}
        >
          <div className="section__head">
            <h2 className="section__title">Activity</h2>
            <span className="section__meta">Every agent action is logged.</span>
          </div>

          <div className="activity-toolbar">
            <label className="section__meta" htmlFor="agent-activity-filter">
              Trigger
            </label>
            <select
              className="select"
              id="agent-activity-filter"
              value={logFilter}
              onChange={(event) => setLogFilter(event.target.value as 'ALL' | AgentTrigger)}
            >
              <option value="ALL">All triggers</option>
              <option value="PROMPT">Prompt</option>
              <option value="CRON">Schedule</option>
              <option value="EVENT">Event</option>
            </select>
            <button
              className="btn btn--outline btn--sm"
              type="button"
              onClick={() => setRefreshToken((current) => current + 1)}
            >
              Refresh
            </button>
          </div>

          {logsError ? (
            <p className="members__error" role="alert">
              {logsError}
            </p>
          ) : null}

          <div className="table-scroll">
            <table className="data-table">
              <caption className="sr-only">Clerk action log</caption>
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Trigger</th>
                  <th scope="col">Tool</th>
                  <th scope="col">Actor</th>
                  <th scope="col">Status</th>
                  <th scope="col">Approval</th>
                  <th scope="col">Ref</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="empty-state">
                      {logsLoading ? 'Reading the log…' : 'No agent activity yet.'}
                    </td>
                  </tr>
                ) : (
                  logs.map((entry) => (
                    <tr
                      key={entry.id}
                      className="is-clickable"
                      onClick={() => setSelectedLog(entry)}
                    >
                      <td>{timeLabel(entry.createdAt)}</td>
                      <td>{TRIGGER_LABEL[entry.trigger]}</td>
                      <td>
                        {entry.toolNames && entry.toolNames.length > 0
                          ? entry.toolNames.join(', ')
                          : '—'}
                      </td>
                      <td>{entry.actor?.name ?? 'Clerk'}</td>
                      <td>
                        <span className={`status ${statusClass(entry.status)}`}>
                          <span className="dot" />
                          {STATUS_LABEL[entry.status]}
                        </span>
                      </td>
                      <td>
                        {entry.approvalStatus
                          ? PROPOSAL_STATUS_LABEL[entry.approvalStatus]
                          : '—'}
                      </td>
                      <td>
                        <button
                          className="link agent-log-ref"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedLog(entry);
                          }}
                        >
                          {entry.logReference}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {selectedLog ? <LogDetail entry={selectedLog} /> : null}
        </section>
      </main>
    </div>
  );
}

function ProposalCard({
  proposal,
  canApprove,
  deciding,
  heading,
  onDecide,
}: {
  proposal: AgentProposal;
  canApprove: boolean;
  deciding: boolean;
  heading?: string;
  onDecide: (proposal: AgentProposal, action: 'approve' | 'reject') => void;
}) {
  const invoice = proposalInvoice(proposal);
  return (
    <article className="approval" aria-label={`Proposal ${proposal.toolName}`}>
      <div className="approval__head">
        <div>
          <p className="approval__title">
            {toolLabel(proposal.toolName)}{' '}
            <span className="muted">· {proposal.toolName}</span>
          </p>
          <p className="approval__meta">
            Requested by {proposal.requestedBy?.name ?? 'Clerk'} ·{' '}
            {timeLabel(proposal.createdAt)}
            {proposal.logReference ? ` · ${proposal.logReference}` : ''}
          </p>
        </div>
        <span className={`status ${proposalStatusClass(proposal.status)}`}>
          <span className="dot" />
          {PROPOSAL_STATUS_LABEL[proposal.status]}
        </span>
      </div>

      {heading ? <p className="agent-detail__label">{heading}</p> : null}
      {proposal.rationale ? (
        <p className="approval__body">{proposal.rationale}</p>
      ) : null}
      <p className="approval__body">{proposalConsequence(proposal.toolName)}</p>
      <pre className="agent-detail__code">
        {JSON.stringify(proposal.args, null, 2)}
      </pre>

      {proposal.status === 'PENDING' ? (
        canApprove ? (
          <div className="approval__actions">
            <button
              className="btn btn--primary btn--sm"
              type="button"
              disabled={deciding}
              onClick={() => onDecide(proposal, 'approve')}
            >
              {deciding ? 'Working…' : 'Approve'}
            </button>
            <button
              className="btn btn--outline btn--sm"
              type="button"
              disabled={deciding}
              onClick={() => onDecide(proposal, 'reject')}
            >
              Reject
            </button>
          </div>
        ) : (
          <p className="approval__result">Owner or Admin approval required.</p>
        )
      ) : null}

      {proposal.status === 'EXECUTING' ? (
        <p className="approval__result" aria-live="polite">
          Executing under the approver’s permissions…
        </p>
      ) : null}

      {proposal.status === 'EXECUTED' ? (
        <p className="approval__result approval__result--approved">
          <span className="dot" />
          Approved by {proposal.decidedBy?.name ?? 'an Owner or Admin'}
          {proposal.executedAt ? ` · executed ${timeLabel(proposal.executedAt)}` : ''}.
          {invoice ? (
            <a className="link" href={`/invoices?invoice=${invoice.id}`}>
              Open {invoice.number ?? 'draft invoice'}
            </a>
          ) : null}
        </p>
      ) : null}

      {proposal.status === 'REJECTED' ? (
        <p className="approval__result approval__result--rejected">
          Rejected by {proposal.decidedBy?.name ?? 'an Owner or Admin'}. No books were
          changed.
          {proposal.decisionNote ? ` “${proposal.decisionNote}”` : ''}
        </p>
      ) : null}

      {proposal.status === 'FAILED' ? (
        <p className="approval__result approval__result--rejected" role="alert">
          Execution failed: {proposal.error ?? 'unknown error'}. No books were changed.
        </p>
      ) : null}
    </article>
  );
}

function AgentJobReply({
  job,
  fallbackRef,
  onOpenActivity,
  onOpenApprovals,
}: {
  job: AgentJob | null;
  fallbackRef?: string;
  onOpenActivity: () => void;
  onOpenApprovals: () => void;
}) {
  if (!job) {
    return <p className="muted">Queued — the agent will start shortly.</p>;
  }
  if (job.status === 'COMPLETED') {
    return (
      <div>
        <p>{job.response}</p>
        <p className="agent-log-line">
          Log{' '}
          <button className="link agent-log-ref" type="button" onClick={onOpenActivity}>
            {job.logReference ?? fallbackRef}
          </button>
          {job.toolNames.length > 0 ? ` · ${job.toolNames.join(', ')}` : ''}
          {` · Model ${MODEL_LABELS[job.model] ?? job.model}`}
        </p>
        {job.proposals && job.proposals.length > 0 ? (
          <p className="agent-log-line">
            Proposal{' '}
            <button
              className="link agent-log-ref"
              type="button"
              onClick={onOpenApprovals}
            >
              {job.proposals[0].logReference ?? 'pending'}
            </button>{' '}
            is waiting for Owner or Admin approval.
          </p>
        ) : null}
        {(!job.proposals || job.proposals.length === 0) &&
        job.toolNames.some(isWriteTool) ? (
          <p className="agent-log-line">
            Executed automatically under this organization’s policy.
          </p>
        ) : null}
      </div>
    );
  }
  if (job.status === 'FAILED') {
    return (
      <div>
        <p>{job.error ?? 'The agent could not complete that request.'}</p>
        <p className="agent-log-line">
          Log{' '}
          <button className="link agent-log-ref" type="button" onClick={onOpenActivity}>
            {job.logReference ?? fallbackRef}
          </button>
        </p>
      </div>
    );
  }
  return (
    <p className="muted" aria-live="polite">
      {busyCopy(job)}
    </p>
  );
}

function LogDetail({ entry }: { entry: AgentLogEntry }) {
  const input = entry.input ? JSON.stringify(entry.input, null, 2) : null;
  const output = entry.output ? JSON.stringify(entry.output, null, 2) : null;
  return (
    <article className="agent-detail" aria-label={`Log entry ${entry.logReference}`}>
      <div className="section__head">
        <h3 className="section__title">{entry.logReference}</h3>
        <span className={`status ${statusClass(entry.status)}`}>
          <span className="dot" />
          {STATUS_LABEL[entry.status]}
        </span>
      </div>
      <dl className="agent-detail__grid">
        <dt>Trigger</dt>
        <dd>{TRIGGER_LABEL[entry.trigger]}</dd>
        <dt>Tool</dt>
        <dd>{entry.toolNames?.join(', ') || '—'}</dd>
        <dt>Actor</dt>
        <dd>{entry.actor?.name ?? 'Clerk'}</dd>
        <dt>Job</dt>
        <dd>{entry.jobId ?? '—'}</dd>
        <dt>Approval</dt>
        <dd>{entry.approvalStatus ?? '—'}</dd>
        <dt>Proposal</dt>
        <dd>{entry.proposalId ?? '—'}</dd>
        <dt>When</dt>
        <dd>{timeLabel(entry.createdAt)}</dd>
      </dl>
      {entry.prompt ? (
        <>
          <h4 className="agent-detail__label">Prompt</h4>
          <pre className="agent-detail__code">{entry.prompt}</pre>
        </>
      ) : null}
      {input ? (
        <>
          <h4 className="agent-detail__label">Input</h4>
          <pre className="agent-detail__code">{input}</pre>
        </>
      ) : null}
      {output ? (
        <>
          <h4 className="agent-detail__label">Output</h4>
          <pre className="agent-detail__code">{output}</pre>
        </>
      ) : null}
      {entry.error ? (
        <>
          <h4 className="agent-detail__label">Error</h4>
          <pre className="agent-detail__code">{entry.error}</pre>
        </>
      ) : null}
    </article>
  );
}
