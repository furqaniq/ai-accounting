import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  describeCron,
  nextRunAt,
  validateCron,
  validateTimezone,
} from './agent-automation.schedule';
import { AgentAutomationScheduler } from './agent-automation-scheduler.service';

function scheduler(seed: Array<Record<string, unknown>> = []): AgentAutomationScheduler {
  const prisma = {
    agentAutomation: { findMany: jest.fn(async () => seed) },
  } as unknown as PrismaService;
  return new AgentAutomationScheduler(prisma);
}

const monday = {
  id: 'automation-1',
  organizationId: 'org-1',
  cron: '0 9 * * 1',
  timezone: 'UTC',
};

describe('automation schedules', () => {
  it('validates five-field cron expressions and IANA timezones', () => {
    expect(validateCron('0 9 * * 1')).toBe('0 9 * * 1');
    expect(validateCron('@daily')).toBe('0 0 * * *');
    expect(validateTimezone('America/New_York')).toBe('America/New_York');
    expect(validateTimezone(undefined)).toBe('UTC');

    expect(() => validateCron('0 9 * *')).toThrow(BadRequestException);
    expect(() => validateCron('not a cron')).toThrow(/Invalid cron|five fields/);
    expect(() => validateCron('99 99 * * *')).toThrow(BadRequestException);
    expect(() => validateTimezone('Mars/Olympus')).toThrow(/Unknown timezone/);
  });

  it('describes common schedules in plain language and exposes the next run', () => {
    expect(describeCron('0 9 * * 1')).toBe('Every Monday at 9:00 AM');
    expect(describeCron('30 18 * * *')).toBe('Every day at 6:30 PM');
    expect(describeCron('0 8 * * 1-5')).toBe('Every weekday at 8:00 AM');
    expect(describeCron('15 10 1 * *')).toBe('Monthly on the 1st at 10:15 AM');
    expect(describeCron('7 4 * * 3,5')).toBe('7 4 * * 3,5');
    expect(nextRunAt('0 9 * * 1', 'UTC')).toMatch(/T09:00:00\.000Z$/);
  });

  it('replaces the same scheduler id instead of duplicating it', async () => {
    const service = scheduler();
    await service.onModuleInit();

    await service.register(monday);
    await service.register({ ...monday, cron: '30 10 * * 1' });

    const rows = await service.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'automation-1',
      cron: '30 10 * * 1',
      timezone: 'UTC',
      organizationId: 'org-1',
    });
  });

  it('removes paused or deleted schedules and restores enabled rows on boot', async () => {
    const service = scheduler([monday]);
    await service.onModuleInit();
    expect(await service.list()).toHaveLength(1);

    await service.remove('automation-1');
    expect(await service.list()).toHaveLength(0);

    await service.register(monday);
    await service.remove('automation-1');
    await service.remove('automation-1');
    expect(await service.list()).toHaveLength(0);
  });

  it('re-registers a schedule after an edit without changing its id', async () => {
    const service = scheduler();
    await service.onModuleInit();
    await service.register(monday);
    await service.remove(monday.id);
    await service.register({ ...monday, cron: '0 6 * * 5' });

    const rows = await service.list();
    expect(rows.map((row) => row.id)).toEqual(['automation-1']);
    expect(rows[0].cron).toBe('0 6 * * 5');
  });
});
