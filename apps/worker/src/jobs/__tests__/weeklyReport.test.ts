import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../lib/prisma', () => ({
  default: {
    auditLog: {
      findMany: vi.fn(),
    },
    userProfile: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('../../lib/messenger', () => ({
  sendMessage: vi.fn(),
}));

import {
  computeWeeklyStats,
  formatWeeklyReport,
  weeklyReportJob,
} from '../weeklyReport';
import prisma from '../../lib/prisma';
import { sendMessage } from '../../lib/messenger';

const baseProfile = {
  id: 'p1',
  proactivity_level: 3,
  inferred_prefs: {
    preferred_period: 'morning',
    top_categories: ['trabalho', 'investimentos'],
  },
};

describe('computeWeeklyStats', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns zero counts when no events', async () => {
    (prisma.auditLog.findMany as any).mockResolvedValue([]);
    const stats = await computeWeeklyStats();
    expect(stats.done).toBe(0);
    expect(stats.postponed).toBe(0);
    expect(stats.created).toBe(0);
  });

  it('counts done events correctly', async () => {
    (prisma.auditLog.findMany as any).mockResolvedValue([
      { action: 'task.done' },
      { action: 'task.done' },
      { action: 'task.postponed' },
      { action: 'task.created' },
    ]);
    const stats = await computeWeeklyStats();
    expect(stats.done).toBe(2);
    expect(stats.postponed).toBe(1);
    expect(stats.created).toBe(1);
  });

  it('queries only last 7 days of events', async () => {
    (prisma.auditLog.findMany as any).mockResolvedValue([]);
    await computeWeeklyStats();
    const callArgs = (prisma.auditLog.findMany as any).mock.calls[0][0];
    expect(callArgs.where.ts.gte).toBeInstanceOf(Date);
    const diff = Date.now() - callArgs.where.ts.gte.getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(diff).toBeLessThan(sevenDaysMs + 5000);
  });
});

describe('formatWeeklyReport', () => {
  it('includes task counts', () => {
    const text = formatWeeklyReport(
      { done: 12, postponed: 4, created: 8 },
      baseProfile
    );
    expect(text).toContain('12');
    expect(text).toContain('4');
    expect(text).toContain('8');
  });

  it('includes preferred period in learned section', () => {
    const text = formatWeeklyReport(
      { done: 5, postponed: 1, created: 3 },
      baseProfile
    );
    expect(text).toContain('manhã');
  });

  it('includes top categories in learned section', () => {
    const text = formatWeeklyReport(
      { done: 5, postponed: 1, created: 3 },
      baseProfile
    );
    expect(text).toContain('trabalho');
    expect(text).toContain('investimentos');
  });

  it('includes proactivity level', () => {
    const text = formatWeeklyReport(
      { done: 5, postponed: 1, created: 3 },
      { ...baseProfile, proactivity_level: 4 }
    );
    expect(text).toContain('4/5');
  });

  it('includes feedback commands', () => {
    const text = formatWeeklyReport({ done: 0, postponed: 0, created: 0 }, baseProfile);
    expect(text).toContain('/mais-proativo');
    expect(text).toContain('/menos-proativo');
    expect(text).toContain('/corrigir');
  });

  it('omits learned section when no inferred prefs', () => {
    const text = formatWeeklyReport(
      { done: 2, postponed: 1, created: 1 },
      { proactivity_level: 3, inferred_prefs: {} }
    );
    expect(text).not.toContain('Aprendi');
  });
});

describe('weeklyReportJob', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls sendMessage with formatted report', async () => {
    (prisma.auditLog.findMany as any).mockResolvedValue([
      { action: 'task.done' },
      { action: 'task.done' },
    ]);
    (prisma.userProfile.findFirst as any).mockResolvedValue(baseProfile);
    (sendMessage as any).mockResolvedValue(undefined);

    await weeklyReportJob();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [, text] = (sendMessage as any).mock.calls[0];
    expect(text).toContain('Relatório semanal');
    expect(text).toContain('2');
  });

  it('uses default profile when no profile exists', async () => {
    (prisma.auditLog.findMany as any).mockResolvedValue([]);
    (prisma.userProfile.findFirst as any).mockResolvedValue(null);
    (sendMessage as any).mockResolvedValue(undefined);

    await weeklyReportJob();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [, text] = (sendMessage as any).mock.calls[0];
    expect(text).toContain('3/5'); // default proactivity level
  });
});
