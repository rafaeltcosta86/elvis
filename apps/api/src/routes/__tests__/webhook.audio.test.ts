import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../lib/prisma', () => ({
  default: {
    communication: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
    task: { create: vi.fn() },
    userProfile: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('../../lib/nanoclawClient', () => ({ sendWhatsApp: vi.fn() }));

vi.mock('../../lib/whisperService', () => ({
  transcribeAudio: vi.fn(),
}));

vi.mock('../../lib/llmService', () => ({
  classifyIntent: vi.fn(),
  suggestAction: vi.fn(),
  normalizeAudioCommand: vi.fn((text: string) => Promise.resolve(text)),
}));

vi.mock('../../lib/redis', () => ({
  default: { set: vi.fn(), get: vi.fn(), del: vi.fn() },
}));

vi.mock('../../lib/contactService', () => ({
  findByAlias: vi.fn().mockResolvedValue(null),
  findByName: vi.fn().mockResolvedValue(null),
  addAlias: vi.fn(),
  createContact: vi.fn(),
}));

import webhookRouter from '../webhook';
import { transcribeAudio } from '../../lib/whisperService';
import { classifyIntent, suggestAction } from '../../lib/llmService';
import { sendWhatsApp } from '../../lib/nanoclawClient';
import prisma from '../../lib/prisma';
import redis from '../../lib/redis';

const app = express();
app.use(express.json());
app.use(webhookRouter);

const SECRET = 'test-secret';
process.env.BAILEYS_WEBHOOK_SECRET = SECRET;

function audioPost(fields: Record<string, string>, audioBuffer?: Buffer) {
  const req = request(app)
    .post('/webhook/baileys-audio')
    .set('Authorization', `Bearer ${SECRET}`);
  if (audioBuffer) {
    req.attach('audio', audioBuffer, { filename: 'audio.ogg', contentType: 'audio/ogg' });
    Object.entries(fields).forEach(([k, v]) => req.field(k, v));
  } else {
    Object.entries(fields).forEach(([k, v]) => req.field(k, v));
  }
  return req;
}

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.communication.create as any).mockResolvedValue({ id: 'test-comm-id' });
  (redis.set as any).mockResolvedValue('OK');
});

describe('POST /webhook/baileys-audio', () => {
  it('retorna 401 com token inválido', async () => {
    const res = await request(app)
      .post('/webhook/baileys-audio')
      .set('Authorization', 'Bearer wrong')
      .field('sender_id', '5511996800178')
      .field('is_forwarded', 'false')
      .field('mimetype', 'audio/ogg');
    expect(res.status).toBe(401);
  });

  it('retorna 400 sem campo audio', async () => {
    const res = await request(app)
      .post('/webhook/baileys-audio')
      .set('Authorization', `Bearer ${SECRET}`)
      .field('sender_id', '5511996800178')
      .field('is_forwarded', 'false')
      .field('mimetype', 'audio/ogg');
    expect(res.status).toBe(400);
  });

  it('áudio próprio (is_forwarded=false): transcreve e executa comando via pipeline completo', async () => {
    vi.mocked(transcribeAudio).mockResolvedValueOnce('lembra de ligar pra Linic amanhã');
    vi.mocked(classifyIntent).mockResolvedValueOnce({ intent: 'UNKNOWN' });
    (prisma.task.create as any).mockResolvedValueOnce({ id: 'task-001', title: 'lembra de ligar pra Linic amanhã' });

    const res = await audioPost(
      { sender_id: '5511996800178', is_forwarded: 'false', mimetype: 'audio/ogg' },
      Buffer.from('fake-audio')
    );

    expect(res.status).toBe(200);
    expect(prisma.task.create).toHaveBeenCalled();
    const sentText: string = vi.mocked(sendWhatsApp).mock.calls[0][1];
    expect(sentText).toContain('lembra de ligar pra Linic amanhã');
    expect(sentText).toContain('✅');
  });

  it('áudio próprio (is_forwarded=false): SEND_TO cria draft e mostra preview com confirm/cancel', async () => {
    process.env.WHATSAPP_CONTACTS = 'amanda:5541999990001';
    vi.mocked(transcribeAudio).mockResolvedValueOnce('manda para amanda: oi');
    (prisma.communication.create as any).mockResolvedValueOnce({ id: 'comm-audio-001', status: 'AWAITING_APPROVAL' });
    (prisma.auditLog.create as any).mockResolvedValueOnce({});

    const res = await audioPost(
      { sender_id: '5511996800178', is_forwarded: 'false', mimetype: 'audio/ogg' },
      Buffer.from('fake-audio')
    );

    expect(res.status).toBe(200);
    expect(prisma.communication.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ to: '5541999990001', status: 'AWAITING_APPROVAL' }),
      })
    );
    const sentText: string = vi.mocked(sendWhatsApp).mock.calls[0][1];
    expect(sentText).toContain('manda para amanda: oi');
    expect(sentText).toContain('1️⃣');
  });

  it('áudio encaminhado (is_forwarded=true) com ação clara: envia sugestão + confirm/cancel', async () => {
    vi.mocked(transcribeAudio).mockResolvedValueOnce('me manda o relatório até quinta');
    vi.mocked(suggestAction).mockResolvedValueOnce({ action: 'criar tarefa', title: 'enviar relatório até quinta' });

    const res = await audioPost(
      { sender_id: '5511996800178', is_forwarded: 'true', mimetype: 'audio/ogg' },
      Buffer.from('fake-audio')
    );

    expect(res.status).toBe(200);
    expect(sendWhatsApp).toHaveBeenCalledWith(
      '5511996800178',
      expect.stringContaining('enviar relatório até quinta')
    );
    expect(sendWhatsApp).toHaveBeenCalledWith(
      '5511996800178',
      expect.stringContaining('1️⃣')
    );
  });

  it('áudio encaminhado com UNKNOWN: envia pergunta aberta sem confirm/cancel', async () => {
    vi.mocked(transcribeAudio).mockResolvedValueOnce('tá bom então a gente vê isso depois');
    vi.mocked(suggestAction).mockResolvedValueOnce(null);

    const res = await audioPost(
      { sender_id: '5511996800178', is_forwarded: 'true', mimetype: 'audio/ogg' },
      Buffer.from('fake-audio')
    );

    expect(res.status).toBe(200);
    const call = vi.mocked(sendWhatsApp).mock.calls.find(([, text]) => text.includes('?'));
    expect(call).toBeDefined();
    expect(call![1]).not.toContain('1️⃣');
  });

  it('transcrição vazia: retorna fallback amigável', async () => {
    vi.mocked(transcribeAudio).mockResolvedValueOnce('');

    const res = await audioPost(
      { sender_id: '5511996800178', is_forwarded: 'false', mimetype: 'audio/ogg' },
      Buffer.from('fake-audio')
    );

    expect(res.status).toBe(200);
    expect(sendWhatsApp).toHaveBeenCalledWith(
      '5511996800178',
      expect.stringContaining('Não consegui entender')
    );
  });
});
