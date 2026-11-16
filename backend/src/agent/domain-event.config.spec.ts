import { BadRequestException } from '@nestjs/common';
import { AgentDomainEventType } from '@prisma/client';
import { DomainEvent } from '../events/domain-events.service';
import {
  buildEventPrompt,
  describeEventTrigger,
  matchesEventTrigger,
  normalizeEventConfig,
  storedEventConfig,
} from './domain-event.config';

describe('Domain event trigger configuration', () => {
  it('normalizes thresholds and fills defaults per event type', () => {
    expect(
      normalizeEventConfig(AgentDomainEventType.INVOICE_OVERDUE, {
        daysOverdue: 5,
      }),
    ).toEqual({ daysOverdue: 5 });
    expect(
      normalizeEventConfig(AgentDomainEventType.BILL_OPENED, {
        minAmount: 250.5,
      }),
    ).toEqual({ minAmount: 250.5 });
    expect(
      normalizeEventConfig(AgentDomainEventType.BILL_OPENED, undefined),
    ).toEqual({ minAmount: 0 });
    expect(
      normalizeEventConfig(
        AgentDomainEventType.RECONCILIATION_DISCREPANCY,
        undefined,
      ),
    ).toEqual({ minDifference: 0 });
    expect(
      normalizeEventConfig(AgentDomainEventType.BANK_TRANSACTION_IMPORTED, {}),
    ).toEqual({});
  });

  it('rejects negative, non-integer, unknown, and foreign keys', () => {
    expect(() =>
      normalizeEventConfig(AgentDomainEventType.INVOICE_OVERDUE, {
        daysOverdue: -1,
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      normalizeEventConfig(AgentDomainEventType.INVOICE_OVERDUE, {
        daysOverdue: 1.5,
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      normalizeEventConfig(AgentDomainEventType.BILL_OPENED, {
        daysOverdue: 2,
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      normalizeEventConfig(AgentDomainEventType.BILL_OPENED, {
        minAmount: '100',
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      normalizeEventConfig(AgentDomainEventType.BANK_TRANSACTION_IMPORTED, {
        minAmount: 1,
      }),
    ).toThrow(BadRequestException);
  });

  it('matches thresholds only for enabled trigger conditions', () => {
    expect(
      matchesEventTrigger(
        AgentDomainEventType.INVOICE_OVERDUE,
        { daysOverdue: 5 },
        { daysOverdue: 4 },
      ),
    ).toBe(false);
    expect(
      matchesEventTrigger(
        AgentDomainEventType.INVOICE_OVERDUE,
        { daysOverdue: 5 },
        { daysOverdue: 5 },
      ),
    ).toBe(true);
    expect(
      matchesEventTrigger(
        AgentDomainEventType.BILL_OPENED,
        { minAmount: 500 },
        { total: 499.99 },
      ),
    ).toBe(false);
    expect(
      matchesEventTrigger(
        AgentDomainEventType.BILL_OPENED,
        { minAmount: 500 },
        { total: 500 },
      ),
    ).toBe(true);
    expect(
      matchesEventTrigger(
        AgentDomainEventType.RECONCILIATION_DISCREPANCY,
        { minDifference: 10 },
        { difference: -12 },
      ),
    ).toBe(true);
    expect(
      matchesEventTrigger(
        AgentDomainEventType.RECONCILIATION_DISCREPANCY,
        { minDifference: 10 },
        { difference: 9.99 },
      ),
    ).toBe(false);
    expect(
      matchesEventTrigger(
        AgentDomainEventType.BANK_TRANSACTION_IMPORTED,
        {},
        {},
      ),
    ).toBe(true);
  });

  it('renders readable trigger labels', () => {
    expect(
      describeEventTrigger(AgentDomainEventType.BANK_TRANSACTION_IMPORTED, {}),
    ).toBe('When a bank transaction is imported');
    expect(
      describeEventTrigger(AgentDomainEventType.INVOICE_OVERDUE, {
        daysOverdue: 1,
      }),
    ).toBe('When an invoice is at least 1 day overdue');
    expect(
      describeEventTrigger(AgentDomainEventType.BILL_OPENED, {
        minAmount: 1000,
      }),
    ).toBe('When a bill opens above $1,000.00');
    expect(
      describeEventTrigger(AgentDomainEventType.RECONCILIATION_DISCREPANCY, {}),
    ).toBe('When a reconciliation has a discrepancy');
  });

  it('reads stored JSON safely and builds record context', () => {
    expect(storedEventConfig(null)).toEqual({});
    expect(storedEventConfig({ minAmount: 10 })).toEqual({ minAmount: 10 });

    const event: DomainEvent = {
      organizationId: 'org-1',
      type: AgentDomainEventType.INVOICE_OVERDUE,
      entityType: 'Invoice',
      entityId: 'invoice-1',
      occurredAt: '2026-11-16T00:00:00.000Z',
      data: {
        number: 'INV-1002',
        customerName: 'Northwind Studio',
        dueDate: '2026-11-01',
        daysOverdue: 15,
        balanceDue: 1200,
      },
    };
    const prompt = buildEventPrompt('Review the receivable.', event);
    expect(prompt).toContain('Review the receivable.');
    expect(prompt).toContain('[Invoice overdue]');
    expect(prompt).toContain('INV-1002');
    expect(prompt).toContain('15 days overdue');
    expect(prompt).toContain('$1,200.00');
    expect(prompt).toContain('Record: Invoice invoice-1.');
  });
});
