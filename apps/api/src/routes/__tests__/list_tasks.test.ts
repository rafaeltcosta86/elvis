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

vi.mock('../../lib/contactService', () => ({
  findByAlias: vi.fn(),
  findByName: vi.fn().mockResolvedValue(null),
  addAlias: vi.fn(),
  listContacts: vi.fn(),
}));

vi.mock('../../lib/llmService', () => ({
  classifyIntent: vi.fn(),
  suggestAction: vi.fn(),
  normalizeAudioCommand: vi.fn(),
}));

vi.mock('../../lib/oauthService', () => ({
  getToken: vi.fn(),
}));

vi.mock('../../lib/redis', () => ({
  default: { set: vi.fn().mockResolvedValue('OK'), get: vi.fn().mockResolvedValue(null), del: vi.fn().mockResolvedValue(1) },
}));

import webhookRouter from '../webhook';
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

describe('Webhook — LIST_TASKS (/tarefas)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
    (sendWhatsApp as any).mockResolvedValue(undefined);
  });

  it('retorna mensagem de lista vazia quando não há tarefas abertas', async () => {
    (prisma.task.findMany as any).mockResolvedValue([]);

    await webhookPost('/tarefas');

    const sentText: string = (sendWhatsApp as any).mock.calls[0][1];
    expect(sentText).toBe('Nenhuma tarefa pendente, pode relaxar! 😎');
  });

  it('retorna lista de tarefas formatada e ordenada', async () => {
    const mockTasks = [
      { title: 'Tarefa 1', created_at: new Date('2023-01-01') },
      { title: 'Tarefa 2', created_at: new Date('2023-01-02') },
    ];
    (prisma.task.findMany as any).mockResolvedValue(mockTasks);

    await webhookPost('/tarefas');

    expect(prisma.task.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: { in: ['PENDING', 'IN_PROGRESS'] } },
      orderBy: { created_at: 'asc' },
    }));

    const sentText: string = (sendWhatsApp as any).mock.calls[0][1];
    expect(sentText).toBe('1. Tarefa 1\n2. Tarefa 2');
  });

  it('é case-insensitive', async () => {
    (prisma.task.findMany as any).mockResolvedValue([]);

    await webhookPost('/TAREFAS');

    expect(prisma.task.findMany).toHaveBeenCalled();
  });
});
