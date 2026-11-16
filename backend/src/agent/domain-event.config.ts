import { BadRequestException } from '@nestjs/common';
import { AgentDomainEventType } from '@prisma/client';
import { DomainEvent } from '../events/domain-events.service';

export interface EventTriggerConfig {
  daysOverdue?: number;
  minAmount?: number;
  minDifference?: number;
}

const ALLOWED_KEYS: Record<AgentDomainEventType, string[]> = {
  BANK_TRANSACTION_IMPORTED: [],
  INVOICE_OVERDUE: ['daysOverdue'],
  BILL_OPENED: ['minAmount'],
  RECONCILIATION_DISCREPANCY: ['minDifference'],
};

const MAX_THRESHOLD = 1_000_000_000;

function numberField(
  raw: Record<string, unknown>,
  key: string,
  options: { integer?: boolean; max: number },
): number | undefined {
  if (raw[key] === undefined) return undefined;
  const value = raw[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new BadRequestException(`${key} must be a number`);
  }
  if (value < 0 || value > options.max) {
    throw new BadRequestException(`${key} must be between 0 and ${options.max}`);
  }
  if (options.integer && !Number.isInteger(value)) {
    throw new BadRequestException(`${key} must be a whole number`);
  }
  return value;
}

/**
 * Validates and normalizes an event automation's trigger configuration. The
 * stored shape is explicit (defaults included) so the API and UI can render a
 * readable trigger without guessing.
 */
export function normalizeEventConfig(
  type: AgentDomainEventType,
  raw: unknown,
): Record<string, number> {
  if (raw === undefined || raw === null) raw = {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BadRequestException('eventConfig must be an object');
  }
  const input = raw as Record<string, unknown>;
  const allowed = ALLOWED_KEYS[type];
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new BadRequestException(
      `eventConfig cannot include ${unknown.join(', ')} for this event type`,
    );
  }

  switch (type) {
    case AgentDomainEventType.INVOICE_OVERDUE:
      return {
        daysOverdue: numberField(input, 'daysOverdue', {
          integer: true,
          max: 3650,
        }) ?? 0,
      };
    case AgentDomainEventType.BILL_OPENED:
      return {
        minAmount: numberField(input, 'minAmount', { max: MAX_THRESHOLD }) ?? 0,
      };
    case AgentDomainEventType.RECONCILIATION_DISCREPANCY:
      return {
        minDifference: numberField(input, 'minDifference', {
          max: MAX_THRESHOLD,
        }) ?? 0,
      };
    default:
      return {};
  }
}

export function storedEventConfig(value: unknown): EventTriggerConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as EventTriggerConfig;
}

function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function money(value: number): string {
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function eventEntityType(type: AgentDomainEventType): string {
  switch (type) {
    case AgentDomainEventType.BANK_TRANSACTION_IMPORTED:
      return 'BankTransaction';
    case AgentDomainEventType.INVOICE_OVERDUE:
      return 'Invoice';
    case AgentDomainEventType.BILL_OPENED:
      return 'Bill';
    case AgentDomainEventType.RECONCILIATION_DISCREPANCY:
      return 'ReconciliationSession';
  }
}

export function eventTypeLabel(type: AgentDomainEventType): string {
  switch (type) {
    case AgentDomainEventType.BANK_TRANSACTION_IMPORTED:
      return 'Bank transaction imported';
    case AgentDomainEventType.INVOICE_OVERDUE:
      return 'Invoice overdue';
    case AgentDomainEventType.BILL_OPENED:
      return 'Bill opened';
    case AgentDomainEventType.RECONCILIATION_DISCREPANCY:
      return 'Reconciliation discrepancy';
  }
}

/** Pure trigger matcher used by the router and its unit tests. */
export function matchesEventTrigger(
  type: AgentDomainEventType,
  config: EventTriggerConfig,
  data: Record<string, unknown>,
): boolean {
  switch (type) {
    case AgentDomainEventType.BANK_TRANSACTION_IMPORTED:
      return true;
    case AgentDomainEventType.INVOICE_OVERDUE:
      return (
        (numeric(data.daysOverdue) ?? 0) >= (config.daysOverdue ?? 0)
      );
    case AgentDomainEventType.BILL_OPENED:
      return (numeric(data.total) ?? 0) >= (config.minAmount ?? 0);
    case AgentDomainEventType.RECONCILIATION_DISCREPANCY:
      return (
        Math.abs(numeric(data.difference) ?? 0) >= (config.minDifference ?? 0)
      );
  }
}

export function describeEventTrigger(
  type: AgentDomainEventType,
  config: EventTriggerConfig,
): string {
  switch (type) {
    case AgentDomainEventType.BANK_TRANSACTION_IMPORTED:
      return 'When a bank transaction is imported';
    case AgentDomainEventType.INVOICE_OVERDUE: {
      const days = config.daysOverdue ?? 0;
      return days > 0
        ? `When an invoice is at least ${days} day${days === 1 ? '' : 's'} overdue`
        : 'When an invoice is overdue';
    }
    case AgentDomainEventType.BILL_OPENED: {
      const amount = config.minAmount ?? 0;
      return amount > 0
        ? `When a bill opens above ${money(amount)}`
        : 'When a bill opens';
    }
    case AgentDomainEventType.RECONCILIATION_DISCREPANCY: {
      const difference = config.minDifference ?? 0;
      return difference > 0
        ? `When a reconciliation has a discrepancy of at least ${money(difference)}`
        : 'When a reconciliation has a discrepancy';
    }
  }
}

function value(data: Record<string, unknown>, key: string): unknown {
  return data[key];
}

/**
 * Adds a concise, human-readable event context to the automation prompt so
 * providers can act on the specific record without a database handle.
 */
export function buildEventPrompt(prompt: string, event: DomainEvent): string {
  const data = event.data;
  let context: string;
  switch (event.type) {
    case AgentDomainEventType.BANK_TRANSACTION_IMPORTED: {
      const amount = numeric(data.amount);
      context = `A new bank transaction was imported: “${String(
        value(data, 'description') ?? 'Bank transaction',
      )}” on ${String(value(data, 'date') ?? 'an unknown date')} for ${
        amount === null ? 'an unknown amount' : money(amount)
      } in ${String(value(data, 'bankAccountName') ?? 'the bank account')}.`;
      break;
    }
    case AgentDomainEventType.INVOICE_OVERDUE: {
      const balance = numeric(data.balanceDue);
      const days = numeric(data.daysOverdue) ?? 0;
      context = `Invoice ${String(value(data, 'number') ?? event.entityId)} for ${String(
        value(data, 'customerName') ?? 'a customer',
      )} is ${days} day${days === 1 ? '' : 's'} overdue (due ${String(
        value(data, 'dueDate') ?? 'unknown',
      )}, balance ${balance === null ? 'unknown' : money(balance)}).`;
      break;
    }
    case AgentDomainEventType.BILL_OPENED: {
      const total = numeric(data.total);
      context = `Bill ${String(value(data, 'number') ?? event.entityId)} from ${String(
        value(data, 'vendorName') ?? 'a vendor',
      )} opened for ${total === null ? 'an unknown amount' : money(total)} (due ${String(
        value(data, 'dueDate') ?? 'unknown',
      )}).`;
      break;
    }
    case AgentDomainEventType.RECONCILIATION_DISCREPANCY: {
      const difference = numeric(data.difference);
      context = `Reconciliation for ${String(
        value(data, 'bankAccountName') ?? 'a bank account',
      )} (${String(value(data, 'periodStart') ?? 'unknown')} to ${String(
        value(data, 'periodEnd') ?? 'unknown',
      )}) has a discrepancy of ${
        difference === null ? 'unknown' : money(Math.abs(difference))
      }.`;
      break;
    }
  }
  return `${prompt.trim()}\n\n[${eventTypeLabel(event.type)}] ${context}\nRecord: ${
    event.entityType
  } ${event.entityId}.`;
}
