'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppSpine } from '@/components/app-spine';
import {
  API_URL,
  ActiveOrganization,
  AgentJob,
  AgentJobStatus,
  AgentLogEntry,
  AgentTrigger,
  clearSession,
  fetchActiveOrganization,
  fetchAgentJob,
  fetchAgentLogs,
  getAccessToken,
  getActiveOrgId,
  setActiveOrgId,
  submitAgentPrompt,
} from '@/lib/api';

type AgentTab = 'ask' | 'activity';

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
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  const suggestions = useMemo(
    () => ["What's my cash position?", 'Show me the profit and loss report'],
    [],
  );

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

  async function send() {
    const text = prompt.trim();
    if (!text || !org || submitting || activeJobId) return;
    setSubmitting(true);
    setError(null);
    const id = `${Date.now()}`;
    setTurns((current) => [...current, { id, role: 'user', text }]);
    setPrompt('');
    try {
      const submission = await submitAgentPrompt(org.organizationId, text);
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
              Works in {org?.organizationName}. Acts with your permissions and only read-only tools
              are available.
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
                  Ask a question about this organization’s books. Clerk can read the dashboard
                  snapshot and generate any report.
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
                  rows={1}
                  value={prompt}
                  placeholder="Ask the clerk about your books"
                  onChange={(event) => setPrompt(event.target.value)}
                  onKeyDown={(event) => {
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
              </div>
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
                  Read-only · Model: Gemini Flash
                </span>
              </div>
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
                  <th scope="col">Ref</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="empty-state">
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

function AgentJobReply({
  job,
  fallbackRef,
  onOpenActivity,
}: {
  job: AgentJob | null;
  fallbackRef?: string;
  onOpenActivity: () => void;
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
        </p>
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
