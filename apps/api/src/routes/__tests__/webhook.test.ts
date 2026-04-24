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
    reminder: {
      create: vi.fn(),
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

vi.mock('../../lib/contactService', () => ({
  findByAlias: vi.fn(),
  findByName: vi.fn().mockResolvedValue(null),
  addAlias: vi.fn(),
  listContacts: vi.fn(),
  updateContact: vi.fn(),
  deleteContact: vi.fn(),
}));

vi.mock('../../lib/llmService', () => ({
  classifyIntent: vi.fn(),
  suggestAction: vi.fn(),
  generateIntroduction: vi.fn(),
  extractReminder: vi.fn(),
}));

vi.mock('../../lib/oauthService', () => ({
  getToken: vi.fn(),
}));

vi.mock('../../lib/redis', () => ({
  default: { set: vi.fn().mockResolvedValue('OK'), get: vi.fn().mockResolvedValue(null), del: vi.fn().mockResolvedValue(1) },
}));

import webhookRouter from '../webhook';
import { getEmailSummary } from '../../lib/emailService';
import { getToken } from '../../lib/oauthService';
import { sendWhatsApp } from '../../lib/nanoclawClient';
import prisma from '../../lib/prisma';
import {
  findByAlias,
  findByName,
  addAlias,
  listContacts,
  updateContact,
} from '../../lib/contactService';
// findByName is mocked to return null by default (env var contacts used instead)
import { classifyIntent, generateIntroduction } from '../../lib/llmService';

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

describe('Webhook — LIST_CONTACTS', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
    (sendWhatsApp as any).mockResolvedValue(undefined);
  });

  it('retorna mensagem de lista vazia quando não há contatos', async () => {
    (listContacts as any).mockResolvedValue([]);

    await webhookPost('/contatos');

    const sentText: string = (sendWhatsApp as any).mock.calls[0][1];
    expect(sentText).toContain('Nenhum contato cadastrado');
  });

  it('retorna lista de contatos formatada', async () => {
    (listContacts as any).mockResolvedValue([
      { name: 'João Silva', aliases: ['/joao'] },
      { name: 'Maria Costa', aliases: ['/maria'] },
    ]);

    await webhookPost('/contatos');

    const sentText: string = (sendWhatsApp as any).mock.calls[0][1];
    expect(sentText).toContain('Seus contatos (2)');
    expect(sentText).toContain('João Silva — /joao');
    expect(sentText).toContain('Maria Costa — /maria');
  });

  it('formata alias com / se não estiver presente', async () => {
    (listContacts as any).mockResolvedValue([
      { name: 'Pedro Alves', aliases: ['pedro_alves'] },
    ]);

    await webhookPost('/contatos');

    const sentText: string = (sendWhatsApp as any).mock.calls[0][1];
    expect(sentText).toContain('Pedro Alves — /pedro_alves');
  });
});

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

describe('Webhook — ALIAS_SHORTCUT', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
    (sendWhatsApp as any).mockResolvedValue(undefined);
    (prisma.communication.create as any).mockResolvedValue({
      id: 'comm-alias-001',
      status: 'AWAITING_APPROVAL',
    });
    (prisma.auditLog.create as any).mockResolvedValue({});
  });

  it('resolves alias and creates draft when alias is found', async () => {
    (findByAlias as any).mockResolvedValue({
      id: 'c1',
      name: 'Linic',
      phone: '5511988880000',
      aliases: ['/linic'],
    });

    await webhookPost('/linic olá tudo bem');

    expect(findByAlias).toHaveBeenCalledWith('/linic');
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
    const sentText: string = (sendWhatsApp as any).mock.calls[0][1];
    expect(sentText).toContain('Linic');
    expect(sentText).toContain('1️⃣');
  });

  it('falls through to CREATE_TASK when alias is not found', async () => {
    (findByAlias as any).mockResolvedValue(null);
    (classifyIntent as any).mockResolvedValue({ intent: 'UNKNOWN' });
    (prisma.task.create as any).mockResolvedValue({ id: 'task-1', title: '/xpto oi' });

    await webhookPost('/xpto oi');

    expect(prisma.task.create).toHaveBeenCalled();
  });
});

describe('Webhook — REGISTER_ALIAS (LLM semântico)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
    (sendWhatsApp as any).mockResolvedValue(undefined);
    (classifyIntent as any).mockResolvedValue({ intent: 'UNKNOWN' });
  });

  it('registers new alias when LLM detects REGISTER_ALIAS intent', async () => {
    (classifyIntent as any).mockResolvedValue({
      intent: 'REGISTER_ALIAS',
      alias: '/li',
      contact_name: 'Linic',
    });
    (addAlias as any).mockResolvedValue({ name: 'Linic', aliases: ['/linic', '/li'] });

    await webhookPost('de agora em diante /li é a Linic');

    expect(classifyIntent).toHaveBeenCalledWith('de agora em diante /li é a Linic');
    expect(addAlias).toHaveBeenCalledWith('Linic', '/li');
    const sentText: string = (sendWhatsApp as any).mock.calls[0][1];
    expect(sentText).toContain('/li');
    expect(sentText).toContain('Linic');
  });

  it('replies with error when contact not found during alias registration', async () => {
    (classifyIntent as any).mockResolvedValue({
      intent: 'REGISTER_ALIAS',
      alias: '/li',
      contact_name: 'Desconhecido',
    });
    (addAlias as any).mockRejectedValue(new Error('Contact "Desconhecido" not found'));

    await webhookPost('de agora em diante /li é a Desconhecido');

    const sentText: string = (sendWhatsApp as any).mock.calls[0][1];
    expect(sentText).toContain('não encontrado');
  });

  it('updates contact when LLM detects EDIT_CONTACT intent', async () => {
    (classifyIntent as any).mockResolvedValue({
      intent: 'EDIT_CONTACT',
      contact_name: 'Siqueira',
      field: 'name',
      new_value: 'Rafa Siqueira',
    });
    (updateContact as any).mockResolvedValue({ name: 'Rafa Siqueira' });

    await webhookPost('mude o nome do Siqueira para Rafa Siqueira');

    expect(classifyIntent).toHaveBeenCalledWith('mude o nome do Siqueira para Rafa Siqueira');
    expect(updateContact).toHaveBeenCalledWith('Siqueira', 'name', 'Rafa Siqueira');
    const sentText: string = (sendWhatsApp as any).mock.calls[0][1];
    expect(sentText).toContain('Contato atualizado: Rafa Siqueira');
  });

  it('replies with error when contact not found during EDIT_CONTACT', async () => {
    (classifyIntent as any).mockResolvedValue({
      intent: 'EDIT_CONTACT',
      contact_name: 'Desconhecido',
      field: 'name',
      new_value: 'Novo Nome',
    });
    (updateContact as any).mockRejectedValue(new Error('Contact "Desconhecido" not found'));

    await webhookPost('mude o nome do Desconhecido para Novo Nome');

    const sentText: string = (sendWhatsApp as any).mock.calls[0][1];
    expect(sentText).toContain('Não encontrei nenhum contato');
  });

  it('creates task when LLM returns UNKNOWN', async () => {
    (classifyIntent as any).mockResolvedValue({ intent: 'UNKNOWN' });
    (prisma.task.create as any).mockResolvedValue({ id: 't1', title: 'comprar pão' });

    await webhookPost('comprar pão amanhã');

    expect(prisma.task.create).toHaveBeenCalled();
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
    expect(sentText).toContain('1️⃣');
    expect(sentText).toContain('2️⃣');
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
    expect(sentText).toContain('Enviado para');
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

describe('Webhook — CREATE_EVENT', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
    (sendWhatsApp as any).mockResolvedValue(undefined);
    (prisma.userProfile.findFirst as any).mockResolvedValue(baseProfile);
  });

  it('retorna mensagem acionável quando OAuth do Outlook não está configurado', async () => {
    (getToken as any).mockResolvedValue(null);
    (classifyIntent as any).mockResolvedValue({ intent: 'CREATE_EVENT', title: 'Reunião', date: 'quinta', time: '15:00', duration_min: 60 });

    await webhookPost('marca uma reunião quinta às 15h');

    const sentText: string = (sendWhatsApp as any).mock.calls[0][1];
    expect(sentText).toContain('❌');
    expect(sentText.toLowerCase()).toMatch(/calendário|oauth|bootstrap/i);
  });

  it('mostra preview do evento quando OAuth está configurado e LLM retorna CREATE_EVENT', async () => {
    (getToken as any).mockResolvedValue('fake-token');
    (classifyIntent as any).mockResolvedValue({
      intent: 'CREATE_EVENT',
      title: 'Reunião com Linic',
      date: '2026-04-17',
      time: '15:00',
      duration_min: 60,
    });
    (prisma.communication.create as any).mockResolvedValue({ id: 'comm-1' });

    await webhookPost('marca reunião com Linic quinta às 15h');

    const sentText: string = (sendWhatsApp as any).mock.calls[0][1];
    expect(sentText).toContain('📅');
    expect(sentText).toContain('Reunião com Linic');
    expect(sentText).toContain('1️⃣');
  });

  it('retorna erro de parse quando LLM não detecta CREATE_EVENT', async () => {
    (getToken as any).mockResolvedValue('fake-token');
    (classifyIntent as any).mockResolvedValue({ intent: 'UNKNOWN' });

    await webhookPost('marca alguma coisa');

    const sentText: string = (sendWhatsApp as any).mock.calls[0][1];
    expect(sentText).toContain('❌');
  });
});

describe('Webhook — INTRODUCE_SELF', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
    (sendWhatsApp as any).mockResolvedValue(undefined);
    (prisma.communication.create as any).mockResolvedValue({ id: 'comm-intro-001' });
    (prisma.auditLog.create as any).mockResolvedValue({});
  });

  it('retorna erro quando o contato não é encontrado', async () => {
    (classifyIntent as any).mockResolvedValue({
      intent: 'INTRODUCE_SELF',
      contact_name: 'Inexistente',
    });
    (findByName as any).mockResolvedValue(null);
    (findByAlias as any).mockResolvedValue(null);

    await webhookPost('se apresenta pro Inexistente');

    const sentText: string = (sendWhatsApp as any).mock.calls[0][1];
    expect(sentText).toContain('❌ Contato "Inexistente" não encontrado');
  });

  it('cria draft e retorna preview ternário quando contato existe', async () => {
    const contact = { id: 'c1', name: 'João', phone: '5511988887777', owner_alias: 'Rafael', aliases: [] };
    (classifyIntent as any).mockResolvedValue({
      intent: 'INTRODUCE_SELF',
      contact_name: 'João',
      context: 'McKinsey',
    });
    (findByName as any).mockResolvedValue(contact);
    (generateIntroduction as any).mockResolvedValue('Olá João, sou o Elvis assistente do Rafael da McKinsey.');

    await webhookPost('se apresenta pro João, diz que somos da McKinsey');

    expect(generateIntroduction).toHaveBeenCalledWith('João', 'McKinsey', 'Rafael');
    expect(prisma.communication.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          to: '5511988887777',
          body: 'Olá João, sou o Elvis assistente do Rafael da McKinsey.',
          status: 'AWAITING_APPROVAL',
        }),
      })
    );

    const sentText: string = (sendWhatsApp as any).mock.calls[0][1];
    expect(sentText).toContain('Apresentação para João');
    expect(sentText).toContain('Olá João, sou o Elvis assistente do Rafael da McKinsey.');
    expect(sentText).toContain('1️⃣ Confirmar');
  });
});
