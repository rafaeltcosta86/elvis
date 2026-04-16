import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../lib/emailService', () => ({
  getEmailSummary: vi.fn(),
}));

vi.mock('../../lib/outlookMailClient', () => ({
  sendEmail: vi.fn(),
}));

vi.mock('../../lib/gmailClient', () => ({
  createGmailClient: vi.fn(),
}));

vi.mock('../../lib/prisma', () => ({
  default: {
    communication: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import emailRouter from '../email';
import { getEmailSummary } from '../../lib/emailService';
import { sendEmail as outlookSendEmail } from '../../lib/outlookMailClient';
import { createGmailClient } from '../../lib/gmailClient';
import prisma from '../../lib/prisma';

const app = express();
app.use(express.json());
app.use('/', emailRouter);

describe('Email Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DRY_RUN;
    delete process.env.SEND_ENABLED;

    // $transaction mock: interactive form passes prisma itself as tx so that
    // mockResolvedValue setups on prisma.communication/auditLog are picked up.
    (prisma.$transaction as any).mockImplementation((arg: any) => {
      if (typeof arg === 'function') return arg(prisma);
      return Promise.all(arg);
    });
  });

  // ─── POST /email/summary ─────────────────────────────────────────────────

  describe('POST /email/summary', () => {
    it('should return 503 when Outlook OAuth not configured', async () => {
      (getEmailSummary as any).mockRejectedValue(new Error('Outlook OAuth not configured'));

      const res = await request(app).post('/email/summary');

      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/Outlook OAuth not configured/);
    });

    it('should return 503 when Gmail OAuth not configured', async () => {
      (getEmailSummary as any).mockRejectedValue(new Error('Gmail OAuth not configured'));

      const res = await request(app).post('/email/summary');

      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/Gmail OAuth not configured/);
    });

    it('should return 200 with outlook and gmail totals', async () => {
      (getEmailSummary as any).mockResolvedValue({
        outlook: { important: [], total: 5 },
        gmail: { important: [], total: 3 },
      });

      const res = await request(app).post('/email/summary');

      expect(res.status).toBe(200);
      expect(res.body.outlook.total).toBe(5);
      expect(res.body.gmail.total).toBe(3);
    });

    it('should return important emails filtered by service', async () => {
      const importantEmail = {
        id: 'e1',
        from: 'x@y.com',
        subject: 'urgente',
        receivedAt: '2026-03-19T10:00:00Z',
        isReply: false,
        snippet: '',
      };
      (getEmailSummary as any).mockResolvedValue({
        outlook: { important: [importantEmail], total: 10 },
        gmail: { important: [], total: 2 },
      });

      const res = await request(app).post('/email/summary');

      expect(res.status).toBe(200);
      expect(res.body.outlook.important).toHaveLength(1);
      expect(res.body.outlook.important[0].id).toBe('e1');
    });

    it('should return 502 when email service throws a non-OAuth error', async () => {
      (getEmailSummary as any).mockRejectedValue(new Error('Graph API error'));

      const res = await request(app).post('/email/summary');

      expect(res.status).toBe(502);
    });
  });

  // ─── POST /email/draft ────────────────────────────────────────────────────

  describe('POST /email/draft', () => {
    it('should return 400 when required fields are missing', async () => {
      const res = await request(app).post('/email/draft').send({ provider: 'OUTLOOK' });

      expect(res.status).toBe(400);
    });

    it('should return 400 for invalid provider', async () => {
      const res = await request(app).post('/email/draft').send({
        provider: 'CARRIER_PIGEON',
        to: 'x@y.com',
        subject: 'Hello',
        body: 'Body',
      });

      expect(res.status).toBe(400);
    });

    it('should create Communication record with status AWAITING_APPROVAL', async () => {
      const comm = {
        id: 'comm-1',
        provider: 'OUTLOOK',
        type: 'DRAFT',
        to: 'x@y.com',
        subject: 'Hello',
        body: 'Body',
        status: 'AWAITING_APPROVAL',
        thread_id: null,
        metadata: {},
        created_at: new Date(),
        approved_at: null,
      };
      (prisma.communication.create as any).mockResolvedValue(comm);
      (prisma.auditLog.create as any).mockResolvedValue({});

      const res = await request(app).post('/email/draft').send({
        provider: 'OUTLOOK',
        to: 'x@y.com',
        subject: 'Hello',
        body: 'Body',
      });

      expect(res.status).toBe(200);
      expect(prisma.communication.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            provider: 'OUTLOOK',
            type: 'DRAFT',
            status: 'AWAITING_APPROVAL',
            to: 'x@y.com',
            subject: 'Hello',
            body: 'Body',
          }),
        })
      );
    });

    it('should return communication_id and preview', async () => {
      const comm = {
        id: 'comm-1',
        provider: 'OUTLOOK',
        type: 'DRAFT',
        to: 'dest@test.com',
        subject: 'My subject',
        body: 'My body',
        status: 'AWAITING_APPROVAL',
        thread_id: null,
        metadata: {},
        created_at: new Date(),
        approved_at: null,
      };
      (prisma.communication.create as any).mockResolvedValue(comm);
      (prisma.auditLog.create as any).mockResolvedValue({});

      const res = await request(app).post('/email/draft').send({
        provider: 'OUTLOOK',
        to: 'dest@test.com',
        subject: 'My subject',
        body: 'My body',
      });

      expect(res.body.communication_id).toBe('comm-1');
      expect(res.body.status).toBe('AWAITING_APPROVAL');
      expect(res.body.preview).toMatchObject({ to: 'dest@test.com', subject: 'My subject' });
    });

    it('should write an AuditLog entry', async () => {
      (prisma.communication.create as any).mockResolvedValue({
        id: 'comm-1',
        provider: 'GMAIL',
        to: 'x@y.com',
        subject: 'S',
        body: 'B',
        status: 'AWAITING_APPROVAL',
      });
      (prisma.auditLog.create as any).mockResolvedValue({});

      await request(app).post('/email/draft').send({
        provider: 'GMAIL',
        to: 'x@y.com',
        subject: 'S',
        body: 'B',
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'email.draft',
            entity_type: 'Communication',
          }),
        })
      );
    });
  });

  // ─── POST /email/send ─────────────────────────────────────────────────────

  describe('POST /email/send', () => {
    it('should return 400 when confirmed is not true', async () => {
      const res = await request(app)
        .post('/email/send')
        .send({ communication_id: 'comm-1', confirmed: false });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/confirmed must be true/);
    });

    it('should return 404 when communication_id does not exist', async () => {
      (prisma.communication.findUnique as any).mockResolvedValue(null);

      const res = await request(app)
        .post('/email/send')
        .send({ communication_id: 'nonexistent', confirmed: true });

      expect(res.status).toBe(404);
    });

    it('should return 409 when communication is already SENT', async () => {
      (prisma.communication.findUnique as any).mockResolvedValue({
        id: 'comm-1',
        status: 'SENT',
        provider: 'OUTLOOK',
        to: 'x@y.com',
        subject: 'S',
        body: 'B',
      });

      const res = await request(app)
        .post('/email/send')
        .send({ communication_id: 'comm-1', confirmed: true });

      expect(res.status).toBe(409);
    });

    it('should return 503 when SEND_ENABLED is not true', async () => {
      process.env.SEND_ENABLED = 'false';
      (prisma.communication.findUnique as any).mockResolvedValue({
        id: 'comm-1',
        status: 'AWAITING_APPROVAL',
        provider: 'OUTLOOK',
        to: 'x@y.com',
        subject: 'S',
        body: 'B',
      });

      const res = await request(app)
        .post('/email/send')
        .send({ communication_id: 'comm-1', confirmed: true });

      expect(res.status).toBe(503);
    });

    it('should return dry_run status when DRY_RUN=true', async () => {
      process.env.DRY_RUN = 'true';
      process.env.SEND_ENABLED = 'true';
      (prisma.communication.findUnique as any).mockResolvedValue({
        id: 'comm-1',
        status: 'AWAITING_APPROVAL',
        provider: 'OUTLOOK',
        to: 'recipient@test.com',
        subject: 'S',
        body: 'B',
      });
      (prisma.communication.update as any).mockResolvedValue({});
      (prisma.auditLog.create as any).mockResolvedValue({});

      const res = await request(app)
        .post('/email/send')
        .send({ communication_id: 'comm-1', confirmed: true });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('dry_run');
      expect(res.body.would_send_to).toBe('recipient@test.com');
    });

    it('should send via outlookSendEmail when provider=OUTLOOK and not dry_run', async () => {
      process.env.SEND_ENABLED = 'true';
      (prisma.communication.findUnique as any).mockResolvedValue({
        id: 'comm-1',
        status: 'AWAITING_APPROVAL',
        provider: 'OUTLOOK',
        to: 'x@y.com',
        subject: 'Hello',
        body: 'Body',
      });
      (outlookSendEmail as any).mockResolvedValue(undefined);
      (prisma.communication.update as any).mockResolvedValue({});
      (prisma.auditLog.create as any).mockResolvedValue({});

      const res = await request(app)
        .post('/email/send')
        .send({ communication_id: 'comm-1', confirmed: true });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('sent');
      expect(outlookSendEmail).toHaveBeenCalledWith('x@y.com', 'Hello', 'Body');
    });

    it('should send via gmailClient when provider=GMAIL and not dry_run', async () => {
      process.env.SEND_ENABLED = 'true';
      const mockGmailSend = vi.fn().mockResolvedValue(undefined);
      (createGmailClient as any).mockResolvedValue({ sendEmail: mockGmailSend });
      (prisma.communication.findUnique as any).mockResolvedValue({
        id: 'comm-2',
        status: 'AWAITING_APPROVAL',
        provider: 'GMAIL',
        to: 'dest@gmail.com',
        subject: 'Subject',
        body: 'Body',
      });
      (prisma.communication.update as any).mockResolvedValue({});
      (prisma.auditLog.create as any).mockResolvedValue({});

      const res = await request(app)
        .post('/email/send')
        .send({ communication_id: 'comm-2', confirmed: true });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('sent');
      expect(mockGmailSend).toHaveBeenCalledWith('dest@gmail.com', 'Subject', 'Body');
    });

    it('should update Communication status to SENT after sending', async () => {
      process.env.SEND_ENABLED = 'true';
      (prisma.communication.findUnique as any).mockResolvedValue({
        id: 'comm-1',
        status: 'AWAITING_APPROVAL',
        provider: 'OUTLOOK',
        to: 'x@y.com',
        subject: 'S',
        body: 'B',
      });
      (outlookSendEmail as any).mockResolvedValue(undefined);
      (prisma.communication.update as any).mockResolvedValue({});
      (prisma.auditLog.create as any).mockResolvedValue({});

      await request(app).post('/email/send').send({ communication_id: 'comm-1', confirmed: true });

      expect(prisma.communication.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'comm-1' },
          data: expect.objectContaining({ status: 'SENT' }),
        })
      );
    });

    it('should write AuditLog entry on successful send', async () => {
      process.env.SEND_ENABLED = 'true';
      (prisma.communication.findUnique as any).mockResolvedValue({
        id: 'comm-1',
        status: 'AWAITING_APPROVAL',
        provider: 'OUTLOOK',
        to: 'x@y.com',
        subject: 'S',
        body: 'B',
      });
      (outlookSendEmail as any).mockResolvedValue(undefined);
      (prisma.communication.update as any).mockResolvedValue({});
      (prisma.auditLog.create as any).mockResolvedValue({});

      await request(app).post('/email/send').send({ communication_id: 'comm-1', confirmed: true });

      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'email.sent', entity_id: 'comm-1' }),
        })
      );
    });

    it('should write AuditLog entry on dry_run', async () => {
      process.env.DRY_RUN = 'true';
      process.env.SEND_ENABLED = 'true';
      (prisma.communication.findUnique as any).mockResolvedValue({
        id: 'comm-1',
        status: 'AWAITING_APPROVAL',
        provider: 'OUTLOOK',
        to: 'x@y.com',
        subject: 'S',
        body: 'B',
      });
      (prisma.communication.update as any).mockResolvedValue({});
      (prisma.auditLog.create as any).mockResolvedValue({});

      await request(app).post('/email/send').send({ communication_id: 'comm-1', confirmed: true });

      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'email.dry_run' }),
        })
      );
    });

    it('should return 502 when send throws', async () => {
      process.env.SEND_ENABLED = 'true';
      (prisma.communication.findUnique as any).mockResolvedValue({
        id: 'comm-1',
        status: 'AWAITING_APPROVAL',
        provider: 'OUTLOOK',
        to: 'x@y.com',
        subject: 'S',
        body: 'B',
      });
      (outlookSendEmail as any).mockRejectedValue(new Error('Graph send error'));
      (prisma.auditLog.create as any).mockResolvedValue({});

      const res = await request(app)
        .post('/email/send')
        .send({ communication_id: 'comm-1', confirmed: true });

      expect(res.status).toBe(502);
    });
  });
});
