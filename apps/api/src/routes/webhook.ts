import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { type Task } from '@prisma/client';
import { parseCommand } from '../lib/commandParser';
import { sendWhatsApp } from '../lib/nanoclawClient';
import prisma from '../lib/prisma';
import { addDays, nextMonday, nextDay, format, parseISO, setHours, setMinutes } from 'date-fns';
import { utcToZonedTime } from 'date-fns-tz';
import { getEmailSummary } from '../lib/emailService';
import { getOrCreateProfile } from '../lib/userModel';
import { findByAlias, findByName, addAlias, createContact, setOwnerAlias } from '../lib/contactService';
import { classifyIntent, suggestAction, normalizeAudioCommand } from '../lib/llmService';
import { getToken } from '../lib/oauthService';
import { transcribeAudio } from '../lib/whisperService';
import multer from 'multer';
import redis from '../lib/redis';

const router = Router();
const TIMEZONE = 'America/Sao_Paulo';
const PENDING_TTL = 600; // 10 minutos

const DAY_MAP: Record<string, 0 | 1 | 2 | 3 | 4 | 5 | 6> = {
  domingo: 0,
  segunda: 1,
  terca: 2,
  quarta: 3,
  quinta: 4,
  sexta: 5,
  sabado: 6,
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

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

// Resolve relative date strings (e.g. "quinta", "amanhã", "YYYY-MM-DD") to ISO date
function resolveDate(dateStr: string): string {
  const now = utcToZonedTime(new Date(), TIMEZONE);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const lower = dateStr.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  if (lower === 'hoje' || lower === 'today') return format(today, 'yyyy-MM-dd');
  if (lower === 'amanha' || lower === 'tomorrow') return format(addDays(today, 1), 'yyyy-MM-dd');
  if (lower === 'proxima segunda' || lower === 'next monday') return format(nextMonday(today), 'yyyy-MM-dd');

  for (const [key, dayOfWeek] of Object.entries(DAY_MAP)) {
    if (lower.startsWith(key)) {
      const resolved = nextDay(today, dayOfWeek);
      return format(resolved, 'yyyy-MM-dd');
    }
  }

  // Already ISO (YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;

  // Fallback: tomorrow
  return format(addDays(today, 1), 'yyyy-MM-dd');
}

function buildEventStartISO(dateStr: string, timeStr: string): string {
  const datePart = resolveDate(dateStr);
  const [h, m] = timeStr.split(':').map(Number);
  const dt = setMinutes(setHours(parseISO(datePart), h ?? 0), m ?? 0);
  return format(dt, "yyyy-MM-dd'T'HH:mm:ss");
}

function eventPreview(title: string, startISO: string, durationMin: number): string {
  const [datePart, timePart] = startISO.split('T');
  const time = (timePart ?? '').substring(0, 5);
  return `📅 Vou marcar:\n*${title}*\n${datePart} às ${time} (${durationMin}min)\n\n1️⃣ Confirmar  |  2️⃣ Cancelar`;
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
  const parts = authHeader.split(' ');
  if (parts.length !== 2) return false;

  const [type, token] = parts;
  if (type !== 'Bearer') return false;

  const tokenBuffer = Buffer.from(token);
  const secretBuffer = Buffer.from(secret);

  if (tokenBuffer.length !== secretBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(tokenBuffer, secretBuffer);
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

      case 'CREATE_EVENT': {
        const calendarToken = await getToken();
        if (!calendarToken) {
          responseText = '❌ Calendário não configurado. Execute o OAuth bootstrap no servidor para habilitar agendamento via áudio.';
          break;
        }
        const eventClassification = await classifyIntent(args?.rawText ?? '');
        if (eventClassification.intent === 'CREATE_EVENT') {
          const startISO = buildEventStartISO(eventClassification.date, eventClassification.time);
          const comm = await prisma.communication.create({
            data: {
              provider: 'WHATSAPP',
              type: 'DRAFT',
              to: null,
              body: null,
              status: 'AWAITING_APPROVAL',
              metadata: {
                kind: 'CREATE_EVENT',
                title: eventClassification.title,
                start: startISO,
                duration_min: eventClassification.duration_min,
              },
            },
          });
          await savePending(sender_id, comm.id);
          responseText = eventPreview(eventClassification.title, startISO, eventClassification.duration_min);
        } else {
          responseText = `❌ Não entendi o evento. Tente: "marca reunião com João quinta às 15h"`;
        }
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

        if (classification.intent === 'CREATE_CONTACT') {
          const alias = '/' + classification.contact_name.toLowerCase().replace(/\s+/g, '');
          try {
            await createContact(classification.contact_name, classification.phone, [alias], classification.owner_alias);
            responseText = `✅ Contato *${classification.contact_name}* criado! Use ${alias} <msg> para mandar mensagem.`;
          } catch {
            responseText = `❌ Não consegui criar o contato. Verifique se o nome já existe.`;
          }
          break;
        }

        if (classification.intent === 'SET_OWNER_ALIAS') {
          try {
            await setOwnerAlias(classification.contact_name, classification.owner_alias);
            responseText = `✅ Pronto! Agora nas mensagens para *${classification.contact_name}* você é *${classification.owner_alias}*.`;
          } catch {
            responseText = `❌ Contato "${classification.contact_name}" não encontrado.`;
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
        // 1. DB contacts (via contactService)
        const dbContact = await findByName(args?.contactName ?? '');
        // 2. Fallback: WHATSAPP_CONTACTS env var
        const envContacts = parseContacts(process.env.WHATSAPP_CONTACTS ?? '');
        const envContact = envContacts.find(
          (c) => c.name.toLowerCase() === (args?.contactName ?? '').toLowerCase()
        );
        const contact = dbContact
          ? { name: dbContact.name, phone: dbContact.phone }
          : envContact ?? null;
        if (!contact) {
          responseText = `❌ "${args?.contactName}" não encontrado. Cadastre com /criar-contato ou adicione em WHATSAPP_CONTACTS=nome:numero`;
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
          responseText = `⚠️ Esta solicitação já foi processada (${comm.status === 'SENT' ? 'confirmada' : 'cancelada'}).`;
          break;
        }

        const confirmMeta = comm.metadata as Record<string, unknown>;

        if (confirmMeta?.kind === 'CREATE_EVENT') {
          // Create calendar event via internal API call
          const { title, start, duration_min } = confirmMeta as { title: string; start: string; duration_min: number };
          const calendarRes = await fetch(`http://localhost:${process.env.PORT ?? 3000}/calendar/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.WEBHOOK_SECRET ?? ''}` },
            body: JSON.stringify({ title, start, duration_min, dry_run: false }),
          });
          const calendarData = await calendarRes.json() as { event?: { subject?: string; start?: { dateTime?: string } }; error?: string };
          await prisma.communication.update({ where: { id: comm.id }, data: { status: 'SENT', approved_at: new Date() } });
          await clearPending(sender_id);
          await prisma.auditLog.create({
            data: {
              actor: 'user',
              action: 'calendar.event_created',
              entity_type: 'Communication',
              entity_id: comm.id,
              summary: `Evento criado: ${title} em ${start}`,
            },
          });
          if (calendarData.error) {
            responseText = `❌ Erro ao criar evento: ${calendarData.error}`;
          } else {
            responseText = `✅ Evento criado!\n*${title}*\n${start.replace('T', ' às ').substring(0, 16)}`;
          }
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
        const meta = comm.metadata as Record<string, string>;
        responseText = `✉️ Enviado para ${meta?.contactName ?? comm.to}.`;
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

async function processWebhook(
  req: Request,
  res: Response,
  provider: string,
  secret: string
) {
  try {
    if (!validateToken(req.headers.authorization, secret)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { sender_id, message_text } = req.body;
    if (!sender_id || !message_text) return res.json({ ok: true });

    const responseText = await handleIncomingWhatsApp(sender_id, message_text);
    await sendWhatsApp(sender_id, responseText);
    res.json({ ok: true });
  } catch (err) {
    console.error(`Webhook ${provider} error:`, err);
    res.json({ ok: true });
  }
}

// ── NanoClaw webhook ────────────────────────────────────────────────────────
router.post('/webhook/nanoclaw', async (req, res) => {
  await processWebhook(req, res, 'nanoclaw', process.env.WEBHOOK_SECRET ?? '');
});

// ── Baileys audio webhook ───────────────────────────────────────────────────
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.post('/webhook/baileys-audio', upload.single('audio'), async (req, res) => {
  try {
    if (!validateToken(req.headers.authorization, process.env.BAILEYS_WEBHOOK_SECRET ?? '')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'campo audio ausente' });
    }

    const sender_id: string = req.body.sender_id ?? '';
    const is_forwarded = req.body.is_forwarded === 'true';
    const mimetype: string = req.body.mimetype ?? req.file.mimetype ?? 'audio/ogg; codecs=opus';

    const text = await transcribeAudio(req.file.buffer, mimetype);

    if (!text) {
      await sendWhatsApp(sender_id, '🎙️ Não consegui entender o áudio. Tente novamente.');
      return res.json({ ok: true });
    }

    let responseText: string;

    if (is_forwarded) {
      const suggestion = await suggestAction(text);
      if (!suggestion) {
        responseText = `🎙️ Transcrevi: "${text}"\n\nNão identifiquei uma ação clara. O que devo fazer com isso?`;
        await sendWhatsApp(sender_id, responseText);
      } else {
        responseText = `🎙️ Áudio de terceiro: "${text}"\n\n💡 Sugestão: ${suggestion.title}\n\n1️⃣ Confirmar  |  2️⃣ Cancelar`;
        const comm = await prisma.communication.create({
          data: {
            provider: 'WHATSAPP',
            type: 'DRAFT',
            to: sender_id,
            body: suggestion.title,
            status: 'AWAITING_APPROVAL',
            metadata: { source: 'audio_forwarded', action: suggestion.action },
          },
        });
        await savePending(sender_id, comm.id);
        await sendWhatsApp(sender_id, responseText);
      }
    } else {
      // Passo 1: normalizar com OWNER_NAME global para detectar o contato
      const normalized = await normalizeAudioCommand(text);
      let finalNormalized = normalized;

      // Passo 2: se for SEND_TO, buscar owner_alias específico do contato
      const parsed = parseCommand(normalized);
      if (parsed.intent === 'SEND_TO' && parsed.args?.contactName) {
        const contact = await findByName(parsed.args.contactName);
        const contactAlias = contact?.owner_alias;
        const defaultAlias = process.env.OWNER_NAME ?? 'Rafael';
        if (contactAlias && contactAlias !== defaultAlias) {
          finalNormalized = await normalizeAudioCommand(text, contactAlias);
        }
      }

      const result = await handleIncomingWhatsApp(sender_id, finalNormalized);
      await sendWhatsApp(sender_id, `🎙️ Entendi: "${text}"\n\n${result}`);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Webhook baileys-audio error:', err);
    res.json({ ok: true });
  }
});

// ── Baileys webhook (internal — called by apps/baileys service) ─────────────
router.post('/webhook/baileys', async (req, res) => {
  await processWebhook(
    req,
    res,
    'baileys',
    process.env.BAILEYS_WEBHOOK_SECRET ?? ''
  );
});

export default router;
