import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../lib/prisma', () => ({
  default: {
    userProfile: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      findMany: vi.fn(),
    },
    task: {
      findMany: vi.fn(),
    },
  },
}));

import userRouter from '../user';
import prisma from '../../lib/prisma';

const app = express();
app.use(express.json());
app.use('/', userRouter);

const baseProfile = {
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

describe('GET /user/profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.auditLog.findMany as any).mockResolvedValue([]);
    (prisma.task.findMany as any).mockResolvedValue([]);
  });

  it('returns 200 with existing profile', async () => {
    (prisma.userProfile.findFirst as any).mockResolvedValue(baseProfile);
    (prisma.userProfile.update as any).mockResolvedValue(baseProfile);

    const res = await request(app).get('/user/profile');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('p1');
  });

  it('creates profile if none exists', async () => {
    (prisma.userProfile.findFirst as any)
      .mockResolvedValueOnce(null)   // getOrCreateProfile: findFirst
      .mockResolvedValueOnce(baseProfile); // second call after update
    (prisma.userProfile.create as any).mockResolvedValue(baseProfile);
    (prisma.userProfile.update as any).mockResolvedValue(baseProfile);

    const res = await request(app).get('/user/profile');
    expect(res.status).toBe(200);
    expect(prisma.userProfile.create).toHaveBeenCalledTimes(1);
  });

  it('returns profile with expected fields', async () => {
    (prisma.userProfile.findFirst as any).mockResolvedValue(baseProfile);
    (prisma.userProfile.update as any).mockResolvedValue(baseProfile);

    const res = await request(app).get('/user/profile');
    expect(res.body).toHaveProperty('proactivity_level');
    expect(res.body).toHaveProperty('inferred_prefs');
    expect(res.body).toHaveProperty('confidence');
    expect(res.body).toHaveProperty('explicit_prefs');
  });

  it('calls updateInferredPrefs (auditLog.findMany invoked)', async () => {
    (prisma.userProfile.findFirst as any).mockResolvedValue(baseProfile);
    (prisma.userProfile.update as any).mockResolvedValue(baseProfile);

    await request(app).get('/user/profile');
    expect(prisma.auditLog.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('POST /user/profile/feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('more_proactive increments proactivity_level', async () => {
    const profile = { ...baseProfile, proactivity_level: 3 };
    (prisma.userProfile.findFirst as any).mockResolvedValue(profile);
    (prisma.userProfile.update as any).mockResolvedValue({ ...profile, proactivity_level: 4 });

    const res = await request(app)
      .post('/user/profile/feedback')
      .send({ action: 'more_proactive' });

    expect(res.status).toBe(200);
    expect(res.body.proactivity_level).toBe(4);
  });

  it('more_proactive clamps at 5', async () => {
    const profile = { ...baseProfile, proactivity_level: 5 };
    (prisma.userProfile.findFirst as any).mockResolvedValue(profile);
    (prisma.userProfile.update as any).mockResolvedValue({ ...profile, proactivity_level: 5 });

    const res = await request(app)
      .post('/user/profile/feedback')
      .send({ action: 'more_proactive' });

    expect(res.status).toBe(200);
    expect(res.body.proactivity_level).toBe(5);
  });

  it('less_proactive decrements proactivity_level', async () => {
    const profile = { ...baseProfile, proactivity_level: 3 };
    (prisma.userProfile.findFirst as any).mockResolvedValue(profile);
    (prisma.userProfile.update as any).mockResolvedValue({ ...profile, proactivity_level: 2 });

    const res = await request(app)
      .post('/user/profile/feedback')
      .send({ action: 'less_proactive' });

    expect(res.status).toBe(200);
    expect(res.body.proactivity_level).toBe(2);
  });

  it('less_proactive clamps at 1', async () => {
    const profile = { ...baseProfile, proactivity_level: 1 };
    (prisma.userProfile.findFirst as any).mockResolvedValue(profile);
    (prisma.userProfile.update as any).mockResolvedValue({ ...profile, proactivity_level: 1 });

    const res = await request(app)
      .post('/user/profile/feedback')
      .send({ action: 'less_proactive' });

    expect(res.status).toBe(200);
    expect(res.body.proactivity_level).toBe(1);
  });

  it('reset_prefs clears inferred_prefs and confidence', async () => {
    const profile = {
      ...baseProfile,
      inferred_prefs: { preferred_period: 'morning' },
      confidence: { data_points: 10, sufficient: true },
    };
    (prisma.userProfile.findFirst as any).mockResolvedValue(profile);
    (prisma.userProfile.update as any).mockResolvedValue({
      ...profile,
      inferred_prefs: {},
      confidence: {},
    });

    const res = await request(app)
      .post('/user/profile/feedback')
      .send({ action: 'reset_prefs' });

    expect(res.status).toBe(200);
    const updateCall = (prisma.userProfile.update as any).mock.calls[0][0];
    expect(updateCall.data.inferred_prefs).toEqual({});
    expect(updateCall.data.confidence).toEqual({});
  });

  it('returns 400 for invalid action', async () => {
    const res = await request(app)
      .post('/user/profile/feedback')
      .send({ action: 'fly_to_moon' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('returns 400 when action is missing', async () => {
    const res = await request(app)
      .post('/user/profile/feedback')
      .send({});

    expect(res.status).toBe(400);
  });
});
