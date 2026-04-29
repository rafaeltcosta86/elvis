import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { type Task } from '@prisma/client';
import { parseCommand, COMMAND_REGISTRY } from '../lib/commandParser';
import { sendWhatsApp } from '../lib/nanoclawClient';
import prisma from '../lib/prisma';
import { addDays, nextMonday, nextDay, format, parseISO, setHours, setMinutes } from 'date-fns';
import { utcToZonedTime, zonedTimeToUtc } from 'date-fns-tz';
import { getEmailSummary } from '../lib/emailService';
import { getOrCreateProfile } from '../lib/userModel';
import {
  findByAlias,
  findByName,
  addAlias,
  createContact,
  setOwnerAlias,
  updateContact,
  listContacts,
  deleteContact,
} from '../lib/contactService';
import {
  classifyIntent,
  suggestAction,
  normalizeAudioCommand,
  extractReminder,
  generateIntroduction,
} from '../lib/llmService';
import { getToken } from '../lib/oauthService';
import { transcribeAudio } from '../lib/whisperService';
import multer from 'multer';
import redis from '../lib/redis';
import { sanitizeError } from '../lib/logger';

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

function deleteContactPreview(name: string, alias: string, phone: string): string {
  return `🗑️ Confirmar deleção?\n\nNome: ${name}\nAlias: ${alias}\nTelefone: ${phone}\n\n1️⃣ Confirmar  |  2️⃣ Cancelar`;
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

async function handleTaskCreation(title: string): Promise<{ text: string; type: 'TASK_CREATED' }> {
  const newTask = await prisma.task.create({
    data: { title, category: 'outros' },
  });

  // Simple heuristic: only call LLM if there's a potential date/time mention
  const hasTimeIndicator = /\b(amanha|hoje|segunda|terca|quarta|quinta|sexta|sabado|domingo|h|min|as|no|na|proxim[oa]|dia)\b/i.test(
    title.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  ) || /\d+/.test(title);

  if (hasTimeIndicator) {
    const reminder = await extractReminder(title, TIMEZONE);
    if (reminder?.remind_at) {
      const remindAt = new Date(reminder.remind_at);
      if (!isNaN(remindAt.getTime())) {
        await prisma.reminder.create({
          data: {
            task_id: newTask.id,
            remind_at: remindAt,
            channel: 'whatsapp',
            status: 'SCHEDULED',
          },
        });
        return { text: '✅ Tarefa criada!', type: 'TASK_CREATED' };
      }
    }

    return {
      text: '✅ Tarefa criada!\n\n⚠️ Não consegui identificar data/hora para o lembrete. A tarefa foi criada sem lembrete.',
      type: 'TASK_CREATED',
    };
  }

  return { text: '✅ Tarefa criada!', type: 'TASK_CREATED' };
}

// Helper para centralizar lógica de envio de mensagem (dry-run/draft)
async function processSendMessage(sender_id: string, contactIdentifier: string, message: string, auditAction = 'whatsapp.draft') {
  const dbContact = (await findByName(contactIdentifier)) || (await findByAlias(contactIdentifier));
  const envContacts = parseContacts(process.env.WHATSAPP_CONTACTS ?? '');
  const envContact = envContacts.find(
    (c) => c.name.toLowerCase() === contactIdentifier.toLowerCase()
  );
  const contact = dbContact ?? (envContact ? { name: envContact.name, phone: envContact.phone } : null);

  if (!contact) {
    return `❌ "${contactIdentifier}" não encontrado. Cadastre com /criar-contato ou adicione em WHATSAPP_CONTACTS=nome:numero`;
  }

  const comm = await prisma.communication.create({
    data: {
      provider: 'WHATSAPP',
      type: 'DRAFT',
      to: contact.phone,
      body: message,
      status: 'AWAITING_APPROVAL',
      metadata: { contactName: contact.name, sender_id },
    },
  });

  await prisma.auditLog.create({
    data: {
      actor: 'user',
      action: auditAction,
      entity_type: 'Communication',
      entity_id: comm.id,
      summary: `Draft WhatsApp para ${contact.name} (${contact.phone})`,
    },
  });

  await savePending(sender_id, comm.id);
  return draftPreview(contact.name, message);
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
): Promise<string | { text: string; type: string }> {
  const pendingId = await getPending(sender_id);
  const trimmed = message_text.trim();

  // If there's a pending confirmation (like SEND_TO or CREATE_EVENT),
  // and the message is 1 or 2, it should be handled by standard parseCommand (CONFIRM/CANCEL)
  // AC4: confirmation has precedence over snooze.
  if (pendingId && (trimmed === '1' || trimmed === '2')) {
    // Let it fall through to parseCommand and then the switch(intent)
  } else {
    // Check for pending snooze
    const snoozeKey = `pending:snooze:${sender_id}`;
    const snoozeData = await redis.get(snoozeKey);

    if (snoozeData && ['1', '2', '3'].includes(trimmed)) {
      const { reminderId, originalHour, originalMinute } = JSON.parse(snoozeData);
      let newRemindAt: Date;
      const now = new Date();

      if (trimmed === '1') {
        newRemindAt = new Date(now.getTime() + 60 * 60 * 1000);
      } else if (trimmed === '2') {
        newRemindAt = new Date(now.getTime() + 4 * 60 * 60 * 1000);
      } else {
        // Option 3: next day same time BRT
        const brtNow = utcToZonedTime(now, TIMEZONE);
        let targetDate = addDays(brtNow, 1);
        targetDate = setHours(targetDate, originalHour);
        targetDate = setMinutes(targetDate, originalMinute);
        newRemindAt = zonedTimeToUtc(targetDate, TIMEZONE);
      }

      await prisma.reminder.update({
        where: { id: reminderId },
        data: { remind_at: newRemindAt, status: 'SCHEDULED' },
      });

      await redis.del(snoozeKey);
      const brtRescheduled = utcToZonedTime(newRemindAt, TIMEZONE);
      return `✅ Lembrete reagendado para ${format(brtRescheduled, 'dd/MM/yyyy')} às ${format(brtRescheduled, 'HH:mm')} (BRT).`;
    }
  }

  const { intent, args } = parseCommand(message_text);
  let responseText = '';

  switch (intent) {
      case 'LIST_COMMANDS': {
        const list = COMMAND_REGISTRY.map((c) => `${c.usage || c.name} — ${c.desc}`).join('\n');
        responseText = `🗂️ Comandos disponíveis:\n\n${list}\n\n💡 Use /<comando> desc para saber mais sobre qualquer comando.`;
        break;
      }

      case 'DESCRIBE_COMMAND': {
        const cmd = COMMAND_REGISTRY.find((c) => c.name === args?.commandName);
        if (cmd) {
          responseText = `${cmd.name} — ${cmd.desc}${cmd.usage ? `\nUso: ${cmd.usage}` : ''}`;
        } else {
          responseText = '❌ Comando não reconhecido. Use /comandos para ver a lista completa.';
        }
        break;
      }

      case 'LIST_CONTACTS': {
        const contacts = await listContacts();
        if (contacts.length === 0) {
          responseText = '📋 Nenhum contato cadastrado.';
        } else {
          const list = contacts
            .map((c) => {
              const alias = c.aliases[0] || '';
              const formattedAlias = alias.startsWith('/') ? alias : `/${alias}`;
              return `• ${c.name} — ${formattedAlias}`;
            })
            .join('\n');
          responseText = `📋 Seus contatos (${contacts.length}):\n${list}`;
        }
        break;
      }

      case 'LIST_TASKS': {
        const tasks = await prisma.task.findMany({
          where: { status: { in: ['PENDING', 'IN_PROGRESS'] } },
          orderBy: { created_at: 'asc' },
        });

        if (tasks.length === 0) {
          responseText = 'Nenhuma tarefa pendente, pode relaxar! 😎';
        } else {
          const list = tasks
            .map((t, index) => `${index + 1}. ${t.title}`)
            .join('\n');
          responseText = list;
        }
        break;
      }

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
        responseText = await processSendMessage(
          sender_id,
          args?.alias ?? '',
          args?.message ?? '',
          'whatsapp.draft.alias'
        );
        if (responseText.includes('não encontrado')) {
          // AC4: If message is "desc" and alias not found, it's likely an unknown command help request
          if (args?.message?.toLowerCase() === 'desc') {
            responseText = '❌ Comando não reconhecido. Use /comandos para ver a lista completa.';
            break;
          }

          // Alias not registered — fallback to task creation
          return handleTaskCreation(message_text);
        }
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

        if (confirmMeta?.sender_id && confirmMeta.sender_id !== sender_id) {
          responseText = `❌ Você não tem permissão para aprovar esta mensagem.`;
          break;
        }

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

        if (confirmMeta?.kind === 'DELETE_CONTACT') {
          const { contactId, contactName } = confirmMeta as { contactId: string; contactName: string };
          await deleteContact(contactId);
          await prisma.communication.update({
            where: { id: comm.id },
            data: { status: 'SENT', approved_at: new Date() },
          });
          await clearPending(sender_id);
          await prisma.auditLog.create({
            data: {
              actor: 'user',
              action: 'contact.deleted',
              entity_type: 'Contact',
              entity_id: contactId,
              summary: `Contato ${contactName} removido`,
            },
          });
          responseText = `✅ Contato ${contactName} removido.`;
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

        const cancelMeta = comm.metadata as Record<string, unknown>;

        if (cancelMeta?.sender_id && cancelMeta.sender_id !== sender_id) {
          responseText = `❌ Você não tem permissão para cancelar esta mensagem.`;
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
            action: cancelMeta?.kind === 'DELETE_CONTACT' ? 'contact.deletion_cancelled' : 'whatsapp.cancelled',
            entity_type: 'Communication',
            entity_id: comm.id,
            summary: cancelMeta?.kind === 'DELETE_CONTACT' ? `Deleção de contato cancelada` : `WhatsApp cancelado para ${comm.to}`,
          },
        });

        if (cancelMeta?.kind === 'DELETE_CONTACT') {
          responseText = `❌ Deleção cancelada.`;
        } else {
          responseText = `🚫 Mensagem cancelada.`;
        }
        break;
      }

      case 'UNKNOWN': {
        // Try LLM classification for any unknown command or plain text
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

        if (classification.intent === 'EDIT_CONTACT') {
          try {
            const updated = await updateContact(
              classification.contact_name,
              classification.field,
              classification.new_value
            );
            responseText = `✅ Contato atualizado: ${updated.name}`;
          } catch (err: any) {
            if (err.code === 'P2002') {
              responseText = `❌ Erro: Já existe um contato com esse nome ou alias.`;
            } else {
              responseText = `❌ Não encontrei nenhum contato com esse nome. Verifique com /contatos.`;
            }
          }
          break;
        }

        if (classification.intent === 'DELETE_CONTACT') {
          const identifier = classification.contact_identifier;
          const contact = identifier.startsWith('/')
            ? await findByAlias(identifier)
            : await findByName(identifier);

          if (!contact) {
            responseText = `❌ Não encontrei nenhum contato com esse nome ou alias. Verifique com /contatos.`;
            break;
          }

          const alias = contact.aliases[0] || '';
          const formattedAlias = alias.startsWith('/') ? alias : `/${alias}`;

          const comm = await prisma.communication.create({
            data: {
              provider: 'WHATSAPP',
              type: 'DRAFT',
              to: null,
              body: null,
              status: 'AWAITING_APPROVAL',
              metadata: {
                kind: 'DELETE_CONTACT',
                contactId: contact.id,
                contactName: contact.name,
                sender_id,
              },
            },
          });
          await savePending(sender_id, comm.id);
          responseText = deleteContactPreview(contact.name, formattedAlias, contact.phone);
          break;
        }

        if (classification.intent === 'INTRODUCE_SELF') {
          const contact = (await findByName(classification.contact_name)) || (await findByAlias(classification.contact_name));

          if (!contact) {
            responseText = `❌ Contato "${classification.contact_name}" não encontrado.`;
            break;
          }

          const ownerAlias = contact.owner_alias || process.env.OWNER_NAME || 'Rafael';
          const generatedMessage = await generateIntroduction(contact.name, classification.context, ownerAlias);

          const comm = await prisma.communication.create({
            data: {
              provider: 'WHATSAPP',
              type: 'DRAFT',
              to: contact.phone,
              body: generatedMessage,
              status: 'AWAITING_APPROVAL',
              metadata: { contactName: contact.name, sender_id },
            },
          });
          await savePending(sender_id, comm.id);
          responseText = `Entendi: Apresentação para ${contact.name}\n\n${draftPreview(contact.name, generatedMessage)}`;
          break;
        }

        if (classification.intent === 'SEND_MESSAGE') {
          responseText = await processSendMessage(
            sender_id,
            classification.contact_name,
            classification.message,
            'whatsapp.draft.llm'
          );
          break;
        }

        if (classification.intent === 'CREATE_EVENT') {
          const calendarToken = await getToken();
          if (!calendarToken) {
            responseText = '❌ Calendário não configurado. Execute o OAuth bootstrap no servidor para habilitar agendamento.';
            break;
          }
          const startISO = buildEventStartISO(classification.date, classification.time);
          const comm = await prisma.communication.create({
            data: {
              provider: 'WHATSAPP',
              type: 'DRAFT',
              to: null,
              body: null,
              status: 'AWAITING_APPROVAL',
              metadata: {
                kind: 'CREATE_EVENT',
                title: classification.title,
                start: startISO,
                duration_min: classification.duration_min,
                sender_id,
              },
            },
          });
          await savePending(sender_id, comm.id);
          responseText = eventPreview(classification.title, startISO, classification.duration_min);
          break;
        }

        const taskTitle = args?.rawText || 'Sem título';
        return handleTaskCreation(taskTitle);
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

    const response = await handleIncomingWhatsApp(sender_id, message_text);
    const responseText = typeof response === 'string' ? response : response.text;
    await sendWhatsApp(sender_id, responseText);
    res.json({ ok: true });
  } catch (err) {
    console.error(`Webhook ${provider} error:`, sanitizeError(err));
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
            metadata: { source: 'audio_forwarded', action: suggestion.action, sender_id },
          },
        });
        await savePending(sender_id, comm.id);
        await sendWhatsApp(sender_id, responseText);
      }
    } else {
      // Passo 1: normalizar com OWNER_NAME global para detectar o contato
      const normalized = await normalizeAudioCommand(text);
      let finalNormalized = normalized;

      // Passo 2: detectar se é um comando de envio para buscar owner_alias específico do contato
      // O formato esperado do normalizeAudioCommand é "manda para <nome>: <mensagem>"
      const audioSendMatch = /^manda para (.*?):/i.exec(normalized);
      if (audioSendMatch) {
        const contactName = audioSendMatch[1].trim();
        const contact = await findByName(contactName);
        const contactAlias = contact?.owner_alias;
        const defaultAlias = process.env.OWNER_NAME ?? 'Rafael';
        if (contactAlias && contactAlias !== defaultAlias) {
          finalNormalized = await normalizeAudioCommand(text, contactAlias);
        }
      }

      const result = await handleIncomingWhatsApp(sender_id, finalNormalized);
      const isTask = typeof result !== 'string' && result.type === 'TASK_CREATED';
      const resultText = typeof result === 'string' ? result : result.text;
      const audioResponse = isTask
        ? resultText
        : `🎙️ Entendi: "${text}"\n\n${resultText}`;
      await sendWhatsApp(sender_id, audioResponse);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Webhook baileys-audio error:', sanitizeError(err));
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
