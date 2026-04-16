import { Router } from 'express';
import { z } from 'zod';
import { getEmailSummary } from '../lib/emailService';
import { sendEmail as outlookSendEmail } from '../lib/outlookMailClient';
import { createGmailClient } from '../lib/gmailClient';
import prisma from '../lib/prisma';

const router = Router();

// ─── POST /email/summary ──────────────────────────────────────────────────────

router.post('/email/summary', async (_req, res) => {
  try {
    const summary = await getEmailSummary();
    res.json(summary);
  } catch (err: any) {
    const message: string = err?.message ?? 'Failed to fetch emails';
    if (message.includes('OAuth not configured')) {
      res.status(503).json({ error: message });
    } else {
      console.error('POST /email/summary error:', err);
      res.status(502).json({ error: 'Failed to fetch emails from providers' });
    }
  }
});

// ─── POST /email/draft ────────────────────────────────────────────────────────

const DraftSchema = z.object({
  provider: z.enum(['OUTLOOK', 'GMAIL']),
  to: z.string().min(1),
  subject: z.string().min(1),
  body: z.string().min(1),
  thread_id: z.string().optional(),
});

router.post('/email/draft', async (req, res) => {
  const parsed = DraftSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request body', details: parsed.error.errors });
    return;
  }

  const { provider, to, subject, body, thread_id } = parsed.data;

  try {
    const comm = await prisma.$transaction(async (tx) => {
      const created = await tx.communication.create({
        data: {
          provider,
          type: 'DRAFT',
          to,
          subject,
          body,
          thread_id: thread_id ?? null,
          status: 'AWAITING_APPROVAL',
        },
      });

      await tx.auditLog.create({
        data: {
          actor: 'user',
          action: 'email.draft',
          entity_type: 'Communication',
          entity_id: created.id,
          summary: `Draft created for ${to}`,
        },
      });

      return created;
    });

    res.json({
      communication_id: comm.id,
      status: 'AWAITING_APPROVAL',
      preview: { to, subject, body },
    });
  } catch (err) {
    console.error('POST /email/draft error:', err);
    res.status(500).json({ error: 'Failed to create draft' });
  }
});

// ─── POST /email/send ─────────────────────────────────────────────────────────

const SendSchema = z.object({
  communication_id: z.string().min(1),
  confirmed: z.literal(true),
});

router.post('/email/send', async (req, res) => {
  const parsed = SendSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'confirmed must be true to send an email' });
    return;
  }

  const { communication_id } = parsed.data;

  const comm = await prisma.communication.findUnique({ where: { id: communication_id } });
  if (!comm) {
    res.status(404).json({ error: 'Communication not found' });
    return;
  }

  if (comm.status === 'SENT') {
    res.status(409).json({ error: 'Email already sent' });
    return;
  }

  if (process.env.SEND_ENABLED !== 'true') {
    res.status(503).json({ error: 'SEND_ENABLED is false — real sends are disabled' });
    return;
  }

  const isDryRun = process.env.DRY_RUN === 'true';

  if (isDryRun) {
    await prisma.$transaction([
      prisma.communication.update({
        where: { id: comm.id },
        data: { status: 'DRY_RUN' },
      }),
      prisma.auditLog.create({
        data: {
          actor: 'user',
          action: 'email.dry_run',
          entity_type: 'Communication',
          entity_id: comm.id,
          summary: `Dry-run send to ${comm.to}`,
        },
      }),
    ]);
    res.json({ status: 'dry_run', would_send_to: comm.to });
    return;
  }

  try {
    if (comm.provider === 'OUTLOOK') {
      await outlookSendEmail(comm.to!, comm.subject!, comm.body!);
    } else if (comm.provider === 'GMAIL') {
      const gmailClient = await createGmailClient();
      await gmailClient.sendEmail(comm.to!, comm.subject!, comm.body!);
    }

    await prisma.$transaction([
      prisma.communication.update({
        where: { id: comm.id },
        data: { status: 'SENT', approved_at: new Date() },
      }),
      prisma.auditLog.create({
        data: {
          actor: 'user',
          action: 'email.sent',
          entity_type: 'Communication',
          entity_id: comm.id,
          summary: `Email sent to ${comm.to}`,
        },
      }),
    ]);

    res.json({ status: 'sent', communication_id: comm.id });
  } catch (err) {
    console.error('POST /email/send error:', err);
    res.status(502).json({ error: 'Failed to send email' });
  }
});

export default router;
