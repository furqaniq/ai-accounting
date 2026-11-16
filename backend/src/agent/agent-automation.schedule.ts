import { BadRequestException } from '@nestjs/common';
import { parseExpression } from 'cron-parser';

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const CRON_ALIASES: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

export function defaultTimezone(): string {
  return 'UTC';
}

/** IANA timezone validation. Throws a 400 for unknown zones. */
export function validateTimezone(timezone?: string): string {
  const value = (timezone ?? defaultTimezone()).trim();
  if (!value) throw new BadRequestException('timezone is required');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
  } catch {
    throw new BadRequestException(`Unknown timezone: ${value}`);
  }
  return value;
}

/** Five-field cron validation with a timezone-aware next-run check. */
export function validateCron(cron?: string, timezone = 'UTC'): string {
  const value = (cron ?? '').trim();
  if (!value) throw new BadRequestException('cron is required');
  const normalized = CRON_ALIASES[value.toLowerCase()] ?? value;
  const fields = normalized.split(/\s+/);
  if (fields.length !== 5) {
    throw new BadRequestException(
      'cron must have exactly five fields (minute hour day-of-month month day-of-week)',
    );
  }
  try {
    const expression = parseExpression(normalized, { tz: timezone });
    expression.next();
  } catch (error) {
    throw new BadRequestException(
      `Invalid cron expression: ${error instanceof Error ? error.message : value}`,
    );
  }
  return normalized;
}

export function nextRunAt(cron: string, timezone: string): string | null {
  try {
    return parseExpression(cron, { tz: timezone }).next().toDate().toISOString();
  } catch {
    return null;
  }
}

function clock(hour: string, minute: string): string {
  const hourNumber = Number.parseInt(hour, 10);
  const minuteNumber = Number.parseInt(minute, 10);
  if (!Number.isFinite(hourNumber) || !Number.isFinite(minuteNumber)) return '';
  const suffix = hourNumber < 12 ? 'AM' : 'PM';
  const displayHour = hourNumber % 12 === 0 ? 12 : hourNumber % 12;
  return `${displayHour}:${String(minuteNumber).padStart(2, '0')} ${suffix}`;
}

function ordinal(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

/**
 * Plain-language schedule for the UI. Falls back to the raw cron expression
 * for shapes it does not recognize, so it never lies about the schedule.
 */
export function describeCron(cron: string): string {
  const normalized = CRON_ALIASES[cron.trim().toLowerCase()] ?? cron.trim();
  const fields = normalized.split(/\s+/);
  if (fields.length !== 5) return cron;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  const numeric = (value: string) => /^\d+$/.test(value);
  const time = numeric(minute) && numeric(hour) ? clock(hour, minute) : '';

  if (time && month === '*' && dayOfMonth === '*') {
    if (dayOfWeek === '*') return `Every day at ${time}`;
    if (dayOfWeek === '1-5') return `Every weekday at ${time}`;
    if (numeric(dayOfWeek)) {
      const day = WEEKDAYS[Number.parseInt(dayOfWeek, 10) % 7];
      return `Every ${day} at ${time}`;
    }
  }
  if (time && month === '*' && dayOfWeek === '*' && numeric(dayOfMonth)) {
    return `Monthly on the ${ordinal(Number.parseInt(dayOfMonth, 10))} at ${time}`;
  }
  return normalized;
}
