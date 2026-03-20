import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../lib/prisma', () => ({
  default: {
    task: {
      findMany: vi.fn(),
    },
    dailyPlan: {
      upsert: vi.fn(),
    },
    userProfile: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      findMany: vi.fn(),
    },
  },
}));

import todayRouter from '../today';
import prisma from '../../lib/prisma';

const app = express();
app.use(express.json());
app.use('/', todayRouter);

const emptyProfile = {
  id: 'p1',
  timezone: 'America/Sao_Paulo',
  proactivity_level: 3,
  daily_nudge_limit: 5,
  explicit_prefs: {},
  inferred_prefs: {},
  confidence: { data_points: 0, sufficient: false, last_updated: new Date().toISOString() },
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  updated_at: new Date(),
};

const sufficientProfile = {
  ...emptyProfile,
  inferred_prefs: {
    preferred_period: 'morning',
    top_categories: ['trabalho', 'investimentos'],
    preferred_hours: [9, 10],
    completion_rate: 0.8,
    avg_postponements: 0.5,
  },
  confidence: { data_points: 10, sufficient: true, last_updated: new Date().toISOString() },
};

describe('GET /today — recommendations field', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.task.findMany as any).mockResolvedValue([]);
    (prisma.auditLog.findMany as any).mockResolvedValue([]);
  });

  it('returns recommendations with active:false when confidence not sufficient', async () => {
    (prisma.userProfile.findFirst as any).mockResolvedValue(emptyProfile);
    (prisma.userProfile.update as any).mockResolvedValue(emptyProfile);

    const res = await request(app).get('/today');
    expect(res.status).toBe(200);
    expect(res.body.recommendations).toBeDefined();
    expect(res.body.recommendations.active).toBe(false);
    expect(res.body.recommendations.message).toBeNull();
  });

  it('returns recommendations with active:true when confidence sufficient', async () => {
    (prisma.userProfile.findFirst as any).mockResolvedValue(sufficientProfile);
    (prisma.userProfile.update as any).mockResolvedValue(sufficientProfile);

    const res = await request(app).get('/today');
    expect(res.status).toBe(200);
    expect(res.body.recommendations.active).toBe(true);
  });

  it('message mentions preferred period when confidence sufficient', async () => {
    (prisma.userProfile.findFirst as any).mockResolvedValue(sufficientProfile);
    (prisma.userProfile.update as any).mockResolvedValue(sufficientProfile);

    const res = await request(app).get('/today');
    expect(res.body.recommendations.message).toContain('manhã');
  });

  it('top_categories returned when confidence sufficient', async () => {
    (prisma.userProfile.findFirst as any).mockResolvedValue(sufficientProfile);
    (prisma.userProfile.update as any).mockResolvedValue(sufficientProfile);

    const res = await request(app).get('/today');
    expect(res.body.recommendations.top_categories).toEqual(['trabalho', 'investimentos']);
  });

  it('preferred_period returned in recommendations', async () => {
    (prisma.userProfile.findFirst as any).mockResolvedValue(sufficientProfile);
    (prisma.userProfile.update as any).mockResolvedValue(sufficientProfile);

    const res = await request(app).get('/today');
    expect(res.body.recommendations.preferred_period).toBe('morning');
  });
});
