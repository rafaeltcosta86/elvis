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
    communication: {
      create: vi.fn(),
      findFirst: vi.fn(),
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
    (prisma.communication.create as any).mockResolvedValue({ id: 'c1' });
    (prisma.communication.findFirst as any).mockResolvedValue({ id: 'c1', to: '123', body: 'msg', metadata: { contactName: 'John' } });
    (prisma.communication.update as any).mockResolvedValue({});
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
    expect(sentText).toContain('Entendi');
    expect(sentText).toContain('resetadas');
    expect(sentText).toContain('Próximo passo');
  });

  it('SEND_TO command creates a pending communication and asks for confirmation', async () => {
    process.env.WHATSAPP_CONTACTS = 'John:123456';
    (prisma.communication.create as any).mockResolvedValue({ id: 'comm-123' });

    await webhookPost('manda para John: Ola');

    expect(prisma.communication.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'AWAITING_APPROVAL',
        to: '123456',
        body: 'Ola'
      })
    }));

    const sentText: string = (sendWhatsApp as any).mock.calls[0][1];
    expect(sentText).toContain('Aguardando');
    expect(sentText).toContain('CONFIRMAR');
  });

  it('APPROVE command sends the pending message', async () => {
    (prisma.communication.findFirst as any).mockResolvedValue({
      id: 'c1',
      to: '123456',
      body: 'Ola John',
      metadata: { contactName: 'John' }
    });

    await webhookPost('CONFIRMAR');

    expect(sendWhatsApp).toHaveBeenCalledWith('123456', 'Ola John');
    expect(prisma.communication.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'c1' },
      data: expect.objectContaining({ status: 'SENT' })
    }));

    const sentText: string = (sendWhatsApp as any).mock.calls[1][1];
    expect(sentText).toContain('sucesso');
  });

  it('returns 200 for proactivity commands', async () => {
    (prisma.userProfile.update as any).mockResolvedValue({ ...baseProfile, proactivity_level: 4 });

    const res = await webhookPost('/mais-proativo');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('Webhook — provider routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WEBHOOK_SECRET = 'secret-nanoclaw';
    process.env.BAILEYS_WEBHOOK_SECRET = 'secret-baileys';
    (prisma.userProfile.findFirst as any).mockResolvedValue(baseProfile);
  });

  it('POST /webhook/nanoclaw validates with WEBHOOK_SECRET', async () => {
    const res = await request(app)
      .post('/webhook/nanoclaw')
      .set('Authorization', 'Bearer secret-nanoclaw')
      .send({ sender_id: '123', message_text: '/hoje' });

    expect(res.status).toBe(200);
  });

  it('POST /webhook/baileys validates with BAILEYS_WEBHOOK_SECRET', async () => {
    const res = await request(app)
      .post('/webhook/baileys')
      .set('Authorization', 'Bearer secret-baileys')
      .send({ sender_id: '123', message_text: '/hoje' });

    expect(res.status).toBe(200);
  });

  it('POST /webhook/nanoclaw returns 401 for invalid token', async () => {
    const res = await request(app)
      .post('/webhook/nanoclaw')
      .set('Authorization', 'Bearer wrong-secret')
      .send({ sender_id: '123', message_text: '/hoje' });

    expect(res.status).toBe(401);
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
