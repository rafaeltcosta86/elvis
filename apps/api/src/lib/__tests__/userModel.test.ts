import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../prisma', () => ({
  default: {
    auditLog: {
      findMany: vi.fn(),
    },
    task: {
      findMany: vi.fn(),
    },
    userProfile: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import {
  inferPreferences,
  computeConfidence,
  updateInferredPrefs,
  getOrCreateProfile,
  type AuditEvent,
} from '../userModel';
import prisma from '../prisma';

// Helper to create an AuditEvent at a given hour
function makeEvent(
  action: string,
  hour: number,
  category?: string,
  entityId = 'task-1'
): AuditEvent {
  const ts = new Date(2026, 2, 10, hour, 0, 0); // March 10 2026
  return { id: 'evt-1', ts, action, entity_id: entityId, metadata: {}, category };
}

describe('inferPreferences', () => {
  it('returns defaults with zero events', () => {
    const prefs = inferPreferences([]);
    expect(prefs.preferred_hours).toEqual([]);
    expect(prefs.preferred_period).toBe('unknown');
    expect(prefs.top_categories).toEqual([]);
    expect(prefs.completion_rate).toBe(0);
    expect(prefs.avg_postponements).toBe(0);
  });

  it('calculates preferred_hours from task.done events', () => {
    const events = [
      makeEvent('task.done', 9),
      makeEvent('task.done', 9),
      makeEvent('task.done', 10),
      makeEvent('task.done', 14),
      makeEvent('task.done', 14),
      makeEvent('task.done', 14),
      makeEvent('task.done', 20),
    ];
    const prefs = inferPreferences(events);
    // Top-3 hours: 14 (3x), 9 (2x), 10 (1x) or 20 (1x)
    expect(prefs.preferred_hours).toContain(14);
    expect(prefs.preferred_hours).toContain(9);
    expect(prefs.preferred_hours.length).toBeLessThanOrEqual(3);
  });

  it('ignores task.postponed events for preferred_hours', () => {
    const events = [
      makeEvent('task.postponed', 9),
      makeEvent('task.postponed', 9),
      makeEvent('task.done', 14),
    ];
    const prefs = inferPreferences(events);
    expect(prefs.preferred_hours).not.toContain(9);
    expect(prefs.preferred_hours).toContain(14);
  });

  it('returns preferred_period morning when most done events are 6-11', () => {
    const events = [
      makeEvent('task.done', 8),
      makeEvent('task.done', 9),
      makeEvent('task.done', 10),
      makeEvent('task.done', 20),
    ];
    const prefs = inferPreferences(events);
    expect(prefs.preferred_period).toBe('morning');
  });

  it('returns preferred_period afternoon when most done events are 12-17', () => {
    const events = [
      makeEvent('task.done', 13),
      makeEvent('task.done', 14),
      makeEvent('task.done', 15),
    ];
    const prefs = inferPreferences(events);
    expect(prefs.preferred_period).toBe('afternoon');
  });

  it('returns preferred_period evening when most done events are 18-22', () => {
    const events = [
      makeEvent('task.done', 19),
      makeEvent('task.done', 20),
      makeEvent('task.done', 21),
    ];
    const prefs = inferPreferences(events);
    expect(prefs.preferred_period).toBe('evening');
  });

  it('returns top_categories from task.done events with category enrichment', () => {
    const events = [
      makeEvent('task.done', 9, 'trabalho'),
      makeEvent('task.done', 10, 'trabalho'),
      makeEvent('task.done', 11, 'trabalho'),
      makeEvent('task.done', 14, 'investimentos'),
      makeEvent('task.done', 15, 'investimentos'),
      makeEvent('task.done', 20, 'pessoal'),
    ];
    const prefs = inferPreferences(events);
    expect(prefs.top_categories[0]).toBe('trabalho');
    expect(prefs.top_categories[1]).toBe('investimentos');
    expect(prefs.top_categories.length).toBeLessThanOrEqual(3);
  });

  it('excludes undefined categories from top_categories', () => {
    const events = [
      makeEvent('task.done', 9, undefined),
      makeEvent('task.done', 10, undefined),
    ];
    const prefs = inferPreferences(events);
    expect(prefs.top_categories).toEqual([]);
  });

  it('calculates completion_rate correctly', () => {
    const events = [
      makeEvent('task.done', 9),
      makeEvent('task.done', 10),
      makeEvent('task.done', 11),
      makeEvent('task.postponed', 14),
    ];
    const prefs = inferPreferences(events);
    expect(prefs.completion_rate).toBeCloseTo(0.75);
  });

  it('returns completion_rate 0 with only postponed events', () => {
    const events = [
      makeEvent('task.postponed', 9),
      makeEvent('task.postponed', 10),
    ];
    const prefs = inferPreferences(events);
    expect(prefs.completion_rate).toBe(0);
  });

  it('calculates avg_postponements correctly', () => {
    // 2 done, 4 postponed → 4/2 = 2.0
    const events = [
      makeEvent('task.done', 9, undefined, 't1'),
      makeEvent('task.done', 10, undefined, 't2'),
      makeEvent('task.postponed', 11, undefined, 't1'),
      makeEvent('task.postponed', 12, undefined, 't1'),
      makeEvent('task.postponed', 13, undefined, 't2'),
      makeEvent('task.postponed', 14, undefined, 't2'),
    ];
    const prefs = inferPreferences(events);
    expect(prefs.avg_postponements).toBeCloseTo(2.0);
  });
});

describe('computeConfidence', () => {
  it('returns data_points 0 and sufficient false for empty events', () => {
    const conf = computeConfidence([]);
    expect(conf.data_points).toBe(0);
    expect(conf.sufficient).toBe(false);
    expect(conf.last_updated).toBeTruthy();
  });

  it('returns sufficient false when data_points < 5', () => {
    const events = [
      makeEvent('task.done', 9),
      makeEvent('task.done', 10),
      makeEvent('task.postponed', 11),
    ];
    const conf = computeConfidence(events);
    expect(conf.data_points).toBe(3);
    expect(conf.sufficient).toBe(false);
  });

  it('returns sufficient true when data_points >= 5', () => {
    const events = Array.from({ length: 5 }, (_, i) => makeEvent('task.done', i + 8));
    const conf = computeConfidence(events);
    expect(conf.data_points).toBe(5);
    expect(conf.sufficient).toBe(true);
  });

  it('last_updated is a valid ISO string', () => {
    const conf = computeConfidence([]);
    expect(() => new Date(conf.last_updated).toISOString()).not.toThrow();
  });
});

describe('getOrCreateProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns existing profile if found', async () => {
    const existing = { id: 'p1', proactivity_level: 4, inferred_prefs: {}, confidence: {} };
    (prisma.userProfile.findFirst as any).mockResolvedValue(existing);

    const result = await getOrCreateProfile();
    expect(result).toEqual(existing);
    expect(prisma.userProfile.create).not.toHaveBeenCalled();
  });

  it('creates a new profile if none exists', async () => {
    (prisma.userProfile.findFirst as any).mockResolvedValue(null);
    const created = { id: 'p2', proactivity_level: 3, inferred_prefs: {}, confidence: {} };
    (prisma.userProfile.create as any).mockResolvedValue(created);

    const result = await getOrCreateProfile();
    expect(prisma.userProfile.create).toHaveBeenCalledTimes(1);
    expect(result).toEqual(created);
  });
});

describe('updateInferredPrefs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls prisma to fetch audit events and updates profile', async () => {
    const profile = { id: 'p1', proactivity_level: 3, inferred_prefs: {}, confidence: {} };
    (prisma.userProfile.findFirst as any).mockResolvedValue(profile);
    (prisma.userProfile.create as any).mockResolvedValue(profile);
    (prisma.auditLog.findMany as any).mockResolvedValue([]);
    (prisma.task.findMany as any).mockResolvedValue([]);
    (prisma.userProfile.update as any).mockResolvedValue(profile);

    await updateInferredPrefs();

    expect(prisma.auditLog.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.userProfile.update).toHaveBeenCalledTimes(1);
  });

  it('enriches events with category from tasks', async () => {
    const profile = { id: 'p1', proactivity_level: 3, inferred_prefs: {}, confidence: {} };
    (prisma.userProfile.findFirst as any).mockResolvedValue(profile);
    (prisma.auditLog.findMany as any).mockResolvedValue([
      { id: 'e1', ts: new Date(2026, 2, 10, 9, 0), action: 'task.done', entity_id: 'task-abc', metadata: {} },
    ]);
    (prisma.task.findMany as any).mockResolvedValue([
      { id: 'task-abc', category: 'trabalho' },
    ]);
    (prisma.userProfile.update as any).mockResolvedValue(profile);

    await updateInferredPrefs();

    const updateCall = (prisma.userProfile.update as any).mock.calls[0][0];
    const inferred = updateCall.data.inferred_prefs;
    expect(inferred.top_categories).toContain('trabalho');
  });
});
