'use client';

import { ChangeEvent, useCallback, useEffect, useId, useState } from 'react';
import {
  Attachment,
  AttachmentEntityType,
  MAX_ATTACHMENT_BYTES,
  deleteAttachment,
  fetchAttachmentUrl,
  fetchAttachments,
  uploadAttachment,
} from '@/lib/api';

interface AttachmentPanelProps {
  organizationId: string;
  entityType: AttachmentEntityType;
  entityId: string;
  canManage: boolean;
  title?: string;
  attachLabel?: string;
  hint?: string;
}

const ACCEPTED = 'application/pdf,image/png,image/jpeg,image/webp';

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function AttachmentPanel({
  organizationId,
  entityType,
  entityId,
  canManage,
  title = 'Receipts & documents',
  attachLabel = 'Attach document',
  hint = 'PDF, PNG, JPEG, or WebP up to 10 MB.',
}: AttachmentPanelProps) {
  const inputId = useId();
  const [attachments, setAttachments] = useState<Attachment[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAttachments(await fetchAttachments(organizationId, entityType, entityId));
      setError(null);
    } catch {
      setError('Documents are not available right now.');
    }
  }, [organizationId, entityType, entityId]);

  useEffect(() => {
    setAttachments(null);
    void load();
  }, [load]);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setError('Attachments must be 10 MB or smaller.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await uploadAttachment(organizationId, entityType, entityId, file);
      setAttachments((current) => [saved, ...(current ?? [])]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not attach that file');
    } finally {
      setBusy(false);
    }
  }

  async function onView(attachment: Attachment) {
    try {
      const url = await fetchAttachmentUrl(organizationId, attachment.id);
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That file is not available');
    }
  }

  async function onRemove(attachment: Attachment) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteAttachment(organizationId, attachment.id);
      setAttachments((current) =>
        (current ?? []).filter((row) => row.id !== attachment.id),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove that file');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="attachments" aria-labelledby={`${inputId}-title`}>
      <div className="attachments__head">
        <div>
          <h3 id={`${inputId}-title`}>{title}</h3>
          <p>{hint}</p>
        </div>
        {canManage ? (
          <>
            <input
              id={inputId}
              className="sr-only"
              type="file"
              accept={ACCEPTED}
              aria-label={attachLabel}
              onChange={(event) => void onFile(event)}
              disabled={busy}
            />
            <label className="btn btn--outline btn--sm" htmlFor={inputId}>
              {busy ? 'Working…' : attachLabel}
            </label>
          </>
        ) : null}
      </div>

      {error ? (
        <p className="members__error" role="alert">
          {error}
        </p>
      ) : null}

      {attachments === null ? (
        <p className="attachments__empty">Opening the document pocket…</p>
      ) : attachments.length === 0 ? (
        <p className="attachments__empty">No documents attached yet.</p>
      ) : (
        <ul className="attachment-list">
          {attachments.map((attachment) => (
            <li className="attachment-row" key={attachment.id}>
              <div className="attachment-row__file">
                <span className="attachment-row__name">{attachment.filename}</span>
                <span className="attachment-row__meta">
                  {formatSize(attachment.size)} · {formatDate(attachment.createdAt)}
                </span>
              </div>
              <div className="attachment-row__actions">
                <button
                  className="btn btn--ghost btn--sm"
                  type="button"
                  onClick={() => void onView(attachment)}
                >
                  View
                </button>
                {canManage ? (
                  <button
                    className="btn btn--ghost btn--sm attachment-row__remove"
                    type="button"
                    aria-label={`Remove ${attachment.filename}`}
                    onClick={() => void onRemove(attachment)}
                    disabled={busy}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
