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
      create: vi.fn(),
    },
    communication: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
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

describe('Webhook — SEND_TO (approval gate)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.WHATSAPP_CONTACTS = 'assistente:5511988880000';
    (sendWhatsApp as any).mockResolvedValue(undefined);
    (prisma.communication.create as any).mockResolvedValue({
      id: 'comm-uuid-001',
      status: 'AWAITING_APPROVAL',
    });
    (prisma.auditLog.create as any).mockResolvedValue({});
  });

  it('does NOT send WhatsApp immediately when SEND_TO is triggered', async () => {
    await webhookPost('manda para assistente: olá tudo bem');

    // sendWhatsApp must only be called once — to reply to the owner (preview), not to the contact
    const calls = (sendWhatsApp as any).mock.calls;
    const sentToContact = calls.some(([to]: [string]) => to === '5511988880000');
    expect(sentToContact).toBe(false);
  });

  it('creates a Communication record with AWAITING_APPROVAL when SEND_TO is triggered', async () => {
    await webhookPost('manda para assistente: olá tudo bem');

    expect(prisma.communication.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: 'WHATSAPP',
          status: 'AWAITING_APPROVAL',
          to: '5511988880000',
          body: 'olá tudo bem',
        }),
      })
    );
  });

  it('replies to owner with a preview and confirmation instructions', async () => {
    await webhookPost('manda para assistente: olá tudo bem');

    const sentText: string = (sendWhatsApp as any).mock.calls[0][1];
    expect(sentText).toContain('assistente');
    expect(sentText).toContain('olá tudo bem');
    expect(sentText).toContain('/confirmar');
    expect(sentText).toContain('/cancelar');
  });

  it('replies with error if contact is not found', async () => {
    await webhookPost('manda para desconhecido: oi');

    const sentText: string = (sendWhatsApp as any).mock.calls[0][1];
    expect(sentText).toContain('não encontrado');
  });
});

describe('Webhook — CONFIRM intent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
    (sendWhatsApp as any).mockResolvedValue(undefined);
    (prisma.auditLog.create as any).mockResolvedValue({});
  });

  it('sends the WhatsApp message and updates status to SENT on confirm', async () => {
    (prisma.communication.findUnique as any).mockResolvedValue({
      id: 'comm-uuid-001',
      provider: 'WHATSAPP',
      status: 'AWAITING_APPROVAL',
      to: '5511988880000',
      body: 'olá tudo bem',
      metadata: { contactName: 'assistente' },
    });
    (prisma.communication.update as any).mockResolvedValue({});

    await webhookPost('/confirmar comm-uuid-001');

    expect(sendWhatsApp).toHaveBeenCalledWith('5511988880000', 'olá tudo bem');
    expect(prisma.communication.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'comm-uuid-001' },
        data: expect.objectContaining({ status: 'SENT' }),
      })
    );
    const sentText: string = (sendWhatsApp as any).mock.calls.find(
      ([to]: [string]) => to === '551199999999'
    )?.[1];
    expect(sentText).toContain('enviada');
  });

  it('replies with error if communication_id not found on confirm', async () => {
    (prisma.communication.findUnique as any).mockResolvedValue(null);

    await webhookPost('/confirmar comm-nao-existe');

    const sentText: string = (sendWhatsApp as any).mock.calls[0][1];
    expect(sentText).toContain('não encontrada');
  });

  it('replies with error if communication is not AWAITING_APPROVAL', async () => {
    (prisma.communication.findUnique as any).mockResolvedValue({
      id: 'comm-uuid-001',
      status: 'SENT',
      to: '5511988880000',
      body: 'olá',
      metadata: {},
    });

    await webhookPost('/confirmar comm-uuid-001');

    const sentText: string = (sendWhatsApp as any).mock.calls[0][1];
    expect(sentText).toContain('já foi');
  });
});

describe('Webhook — CANCEL intent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
    (sendWhatsApp as any).mockResolvedValue(undefined);
    (prisma.auditLog.create as any).mockResolvedValue({});
  });

  it('cancels the communication and does not send WhatsApp on cancel', async () => {
    (prisma.communication.findUnique as any).mockResolvedValue({
      id: 'comm-uuid-001',
      provider: 'WHATSAPP',
      status: 'AWAITING_APPROVAL',
      to: '5511988880000',
      body: 'olá tudo bem',
      metadata: { contactName: 'assistente' },
    });
    (prisma.communication.update as any).mockResolvedValue({});

    await webhookPost('/cancelar comm-uuid-001');

    const sentToContact = (sendWhatsApp as any).mock.calls.some(
      ([to]: [string]) => to === '5511988880000'
    );
    expect(sentToContact).toBe(false);
    expect(prisma.communication.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'comm-uuid-001' },
        data: expect.objectContaining({ status: 'CANCELLED' }),
      })
    );
    const sentText: string = (sendWhatsApp as any).mock.calls[0][1];
    expect(sentText).toContain('cancelada');
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
