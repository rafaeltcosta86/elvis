import { Router } from 'express';
import { type Task } from '@prisma/client';
import { parseCommand } from '../lib/commandParser';
import { sendWhatsApp } from '../lib/nanoclawClient';
import prisma from '../lib/prisma';
import { addDays, nextMonday } from 'date-fns';
import { utcToZonedTime } from 'date-fns-tz';
import { getEmailSummary } from '../lib/emailService';
import { getOrCreateProfile } from '../lib/userModel';
import { findByAlias, addAlias } from '../lib/contactService';
import { classifyIntent } from '../lib/llmService';
import redis from '../lib/redis';

const router = Router();
const TIMEZONE = 'America/Sao_Paulo';
const PENDING_TTL = 600; // 10 minutos

async function savePending(senderId: string, commId: string): Promise<void> {
  await redis.set(`pending:${senderId}`, commId, 'EX', PENDING_TTL);
}

async function getPending(senderId: string): Promise<string | null> {
  return redis.get(`pending:${senderId}`);
}

async function clearPending(senderId: string): Promise<void> {
  await redis.del(`pending:${senderId}`);
}

function draftPreview(contactName: string, message: string): string {
  return `📋 Vou mandar para *${contactName}*:\n"${message}"\n\n1️⃣ Confirmar  |  2️⃣ Cancelar`;
}

// Parse WHATSAPP_CONTACTS=nome:numero,nome2:numero2
function parseContacts(raw: string): Array<{ name: string; phone: string }> {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, phone] = entry.split(':');
      return { name: (name ?? '').trim(), phone: (phone ?? '').trim() };
    })
    .filter((c) => c.name && c.phone);
}

// Validate Bearer token against a given secret
function validateToken(authHeader: string | undefined, secret: string): boolean {
  if (!authHeader) return false;
  const [type, token] = authHeader.split(' ');
  if (type !== 'Bearer') return false;
  return token === secret;
}

// Core handler — shared by all webhook providers
async function handleIncomingWhatsApp(
  sender_id: string,
  message_text: string
): Promise<string> {
  const { intent, args } = parseCommand(message_text);
  let responseText = '';

  switch (intent) {
      case 'TODAY': {
        const today = utcToZonedTime(new Date(), TIMEZONE);
        const todayDate = new Date(
          today.getFullYear(),
          today.getMonth(),
          today.getDate()
        );
        const tomorrow = addDays(todayDate, 1);

        const tasks = await prisma.task.findMany({
          where: { status: { in: ['PENDING', 'IN_PROGRESS'] } },
        });

        const overdue = tasks.filter((t: Task) => t.due_at && t.due_at < todayDate);
        const urgent = tasks.filter(
          (t: Task) =>
            t.priority === 'URGENT' ||
            (t.due_at && t.due_at >= todayDate && t.due_at < tomorrow)
        );

        const top3 = [...overdue, ...urgent].slice(0, 3);
        const topText =
          top3.length > 0
            ? top3.map((t) => `• ${t.title}`).join('\n')
            : '(nenhuma)';

        responseText = `📅 Resumo do dia:\n• ${overdue.length} atrasados\n• ${urgent.length} urgentes\n\nTop 3:\n${topText}`;
        break;
      }

      case 'DONE': {
        if (!args?.taskId) {
          responseText = 'Qual tarefa marcar como pronta? Ex: /done <id>';
          break;
        }

        const task = await prisma.task.findUnique({
          where: { id: args.taskId },
        });

        if (!task) {
          responseText = `Tarefa ${args.taskId} não encontrada.`;
          break;
        }

        await prisma.task.update({
          where: { id: args.taskId },
          data: { status: 'DONE' },
        });

        responseText = `✅ Entendi: Tarefa "${task.title}" marcada como pronta!`;
        break;
      }

      case 'POSTPONE': {
        if (!args?.taskId || !args?.to) {
          responseText =
            'Como adiar? Ex: /adiar <id> tomorrow | /adiar <id> next_week';
          break;
        }

        const task = await prisma.task.findUnique({
          where: { id: args.taskId },
        });

        if (!task) {
          responseText = `Tarefa ${args.taskId} não encontrada.`;
          break;
        }

        const todayDate = utcToZonedTime(new Date(), TIMEZONE);
        let newDueAt: Date;

        if (args.to.toLowerCase() === 'tomorrow') {
          newDueAt = addDays(todayDate, 1);
        } else if (args.to.toLowerCase() === 'next_week') {
          newDueAt = nextMonday(todayDate);
        } else {
          newDueAt = new Date(args.to);
        }

        await prisma.task.update({
          where: { id: args.taskId },
          data: { due_at: newDueAt, status: 'PENDING' },
        });

        responseText = `⏭️  Entendi: Tarefa adiada para ${newDueAt.toLocaleDateString()}`;
        break;
      }

      case 'WEEK': {
        responseText = '📅 Integração de calendário em breve!';
        break;
      }

      case 'EMAIL': {
        const summary = await getEmailSummary().catch(() => null);
        if (!summary) {
          responseText =
            '📧 Não consegui buscar seus e-mails agora. Configure o OAuth ou tente novamente.';
        } else {
          responseText =
            `📧 E-mails de hoje:\n` +
            `Outlook: ${summary.outlook.important.length} importantes / ${summary.outlook.total} total\n` +
            `Gmail: ${summary.gmail.important.length} importante(s) / ${summary.gmail.total} total`;
        }
        break;
      }

      case 'ALIAS_SHORTCUT': {
        const contact = await findByAlias(args?.alias ?? '');
        if (!contact) {
          // Alias not registered — fall through to CREATE_TASK logic
          const newTask = await prisma.task.create({
            data: { title: message_text, category: 'outros' },
          });
          responseText = `✅ Entendi: Tarefa criada! ID: ${newTask.id.substring(0, 8)}...\n\nPrecisa de data? Use: /adiar ${newTask.id} tomorrow`;
          break;
        }
        const comm = await prisma.communication.create({
          data: {
            provider: 'WHATSAPP',
            type: 'DRAFT',
            to: contact.phone,
            body: args?.message ?? '',
            status: 'AWAITING_APPROVAL',
            metadata: { contactName: contact.name },
          },
        });
        await prisma.auditLog.create({
          data: {
            actor: 'user',
            action: 'whatsapp.draft',
            entity_type: 'Communication',
            entity_id: comm.id,
            summary: `Draft WhatsApp para ${contact.name} (${contact.phone}) via atalho ${args?.alias}`,
          },
        });
        await savePending(sender_id, comm.id);
        responseText = draftPreview(contact.name, args?.message ?? '');
        break;
      }

      case 'CREATE_TASK': {
        // Try LLM classification before creating a task
        const classification = await classifyIntent(args?.rawText ?? '');

        if (classification.intent === 'REGISTER_ALIAS') {
          try {
            await addAlias(classification.contact_name, classification.alias);
            responseText = `✅ Registrado! Agora *${classification.alias}* = ${classification.contact_name}.`;
          } catch {
            responseText = `❌ Contato "${classification.contact_name}" não encontrado. Cadastre-o primeiro.`;
          }
          break;
        }

        const newTask = await prisma.task.create({
          data: {
            title: args?.rawText || 'Sem título',
            category: 'outros',
          },
        });

        responseText = `✅ Entendi: Tarefa criada! ID: ${newTask.id.substring(0, 8)}...\n\nPrecisa de data? Use: /adiar ${newTask.id} tomorrow`;
        break;
      }

      case 'MORE_PROACTIVE': {
        const profile = await getOrCreateProfile();
        const newLevel = Math.min(5, profile.proactivity_level + 1);
        await prisma.userProfile.update({ where: { id: profile.id }, data: { proactivity_level: newLevel } });
        responseText = `✅ Entendi! Vou ser mais proativo. Nível atual: ${newLevel}/5`;
        break;
      }

      case 'LESS_PROACTIVE': {
        const profile = await getOrCreateProfile();
        const newLevel = Math.max(1, profile.proactivity_level - 1);
        await prisma.userProfile.update({ where: { id: profile.id }, data: { proactivity_level: newLevel } });
        responseText = `✅ Entendi! Vou ser menos insistente. Nível atual: ${newLevel}/5`;
        break;
      }

      case 'RESET_PREFS': {
        const profile = await getOrCreateProfile();
        await prisma.userProfile.update({
          where: { id: profile.id },
          data: { inferred_prefs: {}, confidence: {} },
        });
        responseText = '🔄 Preferências resetadas. Vou aprender seus hábitos do zero.';
        break;
      }

      case 'SEND_TO': {
        const contacts = parseContacts(process.env.WHATSAPP_CONTACTS ?? '');
        const contact = contacts.find(
          (c) => c.name.toLowerCase() === (args?.contactName ?? '').toLowerCase()
        );
        if (!contact) {
          responseText = `❌ "${args?.contactName}" não encontrado. Adicione em WHATSAPP_CONTACTS=nome:numero`;
          break;
        }
        const comm = await prisma.communication.create({
          data: {
            provider: 'WHATSAPP',
            type: 'DRAFT',
            to: contact.phone,
            body: args?.message ?? '',
            status: 'AWAITING_APPROVAL',
            metadata: { contactName: contact.name },
          },
        });
        await prisma.auditLog.create({
          data: {
            actor: 'user',
            action: 'whatsapp.draft',
            entity_type: 'Communication',
            entity_id: comm.id,
            summary: `Draft WhatsApp para ${contact.name} (${contact.phone})`,
          },
        });
        await savePending(sender_id, comm.id);
        responseText = draftPreview(contact.name, args?.message ?? '');
        break;
      }

      case 'CONFIRM': {
        const commId = args?.communication_id ?? await getPending(sender_id);
        const comm = commId ? await prisma.communication.findUnique({ where: { id: commId } }) : null;
        if (!comm) {
          responseText = `❌ Solicitação não encontrada.`;
          break;
        }
        if (comm.status !== 'AWAITING_APPROVAL') {
          responseText = `⚠️ Esta mensagem já foi processada (${comm.status === 'SENT' ? 'enviada' : 'cancelada'}).`;
          break;
        }
        await sendWhatsApp(comm.to!, comm.body!);
        await prisma.communication.update({
          where: { id: comm.id },
          data: { status: 'SENT', approved_at: new Date() },
        });
        await clearPending(sender_id);
        await prisma.auditLog.create({
          data: {
            actor: 'user',
            action: 'whatsapp.sent',
            entity_type: 'Communication',
            entity_id: comm.id,
            summary: `WhatsApp enviado para ${comm.to}`,
          },
        });
        responseText = comm.body!;
        break;
      }

      case 'CANCEL': {
        const commId = args?.communication_id ?? await getPending(sender_id);
        const comm = commId ? await prisma.communication.findUnique({ where: { id: commId } }) : null;
        if (!comm) {
          responseText = `❌ Solicitação não encontrada.`;
          break;
        }
        if (comm.status !== 'AWAITING_APPROVAL') {
          responseText = `⚠️ Esta mensagem já foi processada.`;
          break;
        }
        await prisma.communication.update({
          where: { id: comm.id },
          data: { status: 'CANCELLED' },
        });
        await clearPending(sender_id);
        await prisma.auditLog.create({
          data: {
            actor: 'user',
            action: 'whatsapp.cancelled',
            entity_type: 'Communication',
            entity_id: comm.id,
            summary: `WhatsApp cancelado para ${comm.to}`,
          },
        });
        responseText = `🚫 Mensagem cancelada.`;
        break;
      }

      case 'UNKNOWN': {
        responseText =
          'Não entendi. Comandos:\n/hoje — resumo\n/done <id> — pronto\n/adiar <id> tomorrow — adiar\n/semana — semana\n/email — e-mails\nmanda para <nome>: <msg>';
        break;
      }
    }

  return responseText;
}

// ── NanoClaw webhook ────────────────────────────────────────────────────────
router.post('/webhook/nanoclaw', async (req, res) => {
  try {
    if (!validateToken(req.headers.authorization, process.env.WEBHOOK_SECRET ?? '')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { sender_id, message_text } = req.body;
    if (!sender_id || !message_text) return res.json({ ok: true });

    const responseText = await handleIncomingWhatsApp(sender_id, message_text);
    await sendWhatsApp(sender_id, responseText);
    res.json({ ok: true });
  } catch (err) {
    console.error('Webhook nanoclaw error:', err);
    res.json({ ok: true });
  }
});

// ── Baileys webhook (internal — called by apps/baileys service) ─────────────
router.post('/webhook/baileys', async (req, res) => {
  try {
    if (!validateToken(req.headers.authorization, process.env.BAILEYS_WEBHOOK_SECRET ?? '')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { sender_id, message_text } = req.body;
    if (!sender_id || !message_text) return res.json({ ok: true });

    const responseText = await handleIncomingWhatsApp(sender_id, message_text);
    await sendWhatsApp(sender_id, responseText);
    res.json({ ok: true });
  } catch (err) {
    console.error('Webhook baileys error:', err);
    res.json({ ok: true });
  }
});

export default router;
