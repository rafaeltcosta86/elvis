import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../lib/prisma', () => ({
  default: {
    task: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
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

vi.mock('../../lib/nanoclawClient', () => ({
  sendWhatsApp: vi.fn(),
}));

vi.mock('../../lib/emailService', () => ({
  getEmailSummary: vi.fn(),
}));

import webhookRouter from '../webhook';
import { getEmailSummary } from '../../lib/emailService';
import { sendWhatsApp } from '../../lib/nanoclawClient';
import prisma from '../../lib/prisma';

const app = express();
app.use(express.json());
app.use('/', webhookRouter);

const WEBHOOK_SECRET = 'test-secret';

function webhookPost(messageText: string) {
  return request(app)
    .post('/webhook/nanoclaw')
    .set('Authorization', `Bearer ${WEBHOOK_SECRET}`)
    .send({
      sender_id: '551199999999',
      message_text: messageText,
      message_id: 'msg-001',
      timestamp: 1700000000,
    });
}

const baseProfile = { id: 'p1', proactivity_level: 3 };

describe('Webhook — proactivity commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
    (prisma.userProfile.findFirst as any).mockResolvedValue(baseProfile);
    (prisma.userProfile.update as any).mockResolvedValue({ ...baseProfile, proactivity_level: 4 });
    (sendWhatsApp as any).mockResolvedValue(undefined);
  });

  it('/mais-proativo sends MORE_PROACTIVE response with level', async () => {
    (prisma.userProfile.update as any).mockResolvedValue({ ...baseProfile, proactivity_level: 4 });

    await webhookPost('/mais-proativo');

    const sentText: string = (sendWhatsApp as any).mock.calls[0][1];
    expect(sentText).toContain('proativo');
    expect(sentText).toContain('4/5');
  });

  it('/menos-proativo sends LESS_PROACTIVE response with level', async () => {
    (prisma.userProfile.update as any).mockResolvedValue({ ...baseProfile, proactivity_level: 2 });

    await webhookPost('/menos-proativo');

    const sentText: string = (sendWhatsApp as any).mock.calls[0][1];
    expect(sentText).toContain('insistente');
    expect(sentText).toContain('2/5');
  });

  it('/corrigir sends RESET_PREFS response', async () => {
    (prisma.userProfile.update as any).mockResolvedValue(baseProfile);

    await webhookPost('/corrigir');

    const sentText: string = (sendWhatsApp as any).mock.calls[0][1];
    expect(sentText).toContain('resetadas');
  });

  it('returns 200 for proactivity commands', async () => {
    (prisma.userProfile.update as any).mockResolvedValue({ ...baseProfile, proactivity_level: 4 });

    const res = await webhookPost('/mais-proativo');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('Webhook — EMAIL intent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
  });

  it('should call getEmailSummary when intent is EMAIL', async () => {
    (getEmailSummary as any).mockResolvedValue({
      outlook: { important: [], total: 0 },
      gmail: { important: [], total: 0 },
    });

    await webhookPost('/email');

    expect(getEmailSummary).toHaveBeenCalledTimes(1);
  });

  it('should send formatted WhatsApp message with email counts', async () => {
    (getEmailSummary as any).mockResolvedValue({
      outlook: { important: [{ id: 'e1' }], total: 8 },
      gmail: { important: [{ id: 'g1' }, { id: 'g2' }], total: 5 },
    });

    await webhookPost('/email');

    const sentText: string = (sendWhatsApp as any).mock.calls[0][1];
    expect(sentText).toContain('Outlook');
    expect(sentText).toContain('8');
    expect(sentText).toContain('Gmail');
    expect(sentText).toContain('5');
  });

  it('should return 200 even when getEmailSummary throws', async () => {
    (getEmailSummary as any).mockRejectedValue(new Error('OAuth not configured'));

    const res = await webhookPost('/email');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('should send fallback message when getEmailSummary returns null or throws', async () => {
    (getEmailSummary as any).mockRejectedValue(new Error('OAuth not configured'));

    await webhookPost('/email');

    const sentText: string = (sendWhatsApp as any).mock.calls[0][1];
    expect(sentText).toContain('e-mails');
  });
});
