import { Router, Request, Response } from 'express';
import { type Task } from '@prisma/client';
import { parseCommand } from '../lib/commandParser';
import { sendWhatsApp } from '../lib/nanoclawClient';
import prisma from '../lib/prisma';
import { addDays, nextMonday } from 'date-fns';
import { utcToZonedTime } from 'date-fns-tz';
import { getEmailSummary } from '../lib/emailService';
import { getOrCreateProfile } from '../lib/userModel';

const router = Router();
const TIMEZONE = 'America/Sao_Paulo';

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

        responseText = `✅ Entendi: Resumo do dia solicitado.\n\n📅 Status:\n• ${overdue.length} atrasados\n• ${urgent.length} urgentes\n\nTop 3:\n${topText}\n\nPróximo passo: Resolver os itens atrasados ou adiar para amanhã.`;
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

        responseText = `✅ Entendi: Marcar tarefa "${task.title}" como concluída.\n\n✨ Feito: Tarefa ${args.taskId} agora está com status DONE.\n\nPróximo passo: Deseja ver o resumo do que falta para hoje? (/hoje)`;
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

        responseText = `✅ Entendi: Adiar tarefa "${task.title}" para ${newDueAt.toLocaleDateString()}.\n\n⏭️  Feito: Data de entrega atualizada.\n\nPróximo passo: Posso te ajudar com mais alguma tarefa?`;
        break;
      }

      case 'WEEK': {
        responseText = '✅ Entendi: Você quer ver sua agenda da semana.\n\n📅 Feito: Busquei seus compromissos (Integração em breve!)\n\nPróximo passo: Tente /hoje para ver as tarefas urgentes.';
        break;
      }

      case 'EMAIL': {
        const summary = await getEmailSummary().catch(() => null);
        if (!summary) {
          responseText =
            '❌ Entendi: Você quer o resumo de e-mails.\n\n📧 Erro: Não consegui buscar seus e-mails agora. Configure o OAuth ou tente novamente.\n\nPróximo passo: Verifique suas credenciais em /user/profile.';
        } else {
          responseText =
            `✅ Entendi: Resumo de e-mails solicitado.\n\n` +
            `📧 E-mails de hoje:\n` +
            `• Outlook: ${summary.outlook.important.length} importantes / ${summary.outlook.total} total\n` +
            `• Gmail: ${summary.gmail.important.length} importante(s) / ${summary.gmail.total} total\n\n` +
            `Próximo passo: Deseja que eu gere rascunhos para as mensagens importantes?`;
        }
        break;
      }

      case 'CREATE_TASK': {
        const newTask = await prisma.task.create({
          data: {
            title: args?.rawText || 'Sem título',
            category: 'outros',
          },
        });

        responseText = `✅ Entendi: Criar nova tarefa "${args?.rawText}".\n\n✨ Feito: Tarefa criada! ID: ${newTask.id.substring(0, 8)}...\n\nPróximo passo: Precisa de data? Use: /adiar ${newTask.id.substring(0, 8)} tomorrow`;
        break;
      }

      case 'MORE_PROACTIVE': {
        const profile = await getOrCreateProfile();
        const newLevel = Math.min(5, profile.proactivity_level + 1);
        await prisma.userProfile.update({ where: { id: profile.id }, data: { proactivity_level: newLevel } });
        responseText = `✅ Entendi: Aumentar proatividade.\n\n🚀 Feito: Vou ser mais proativo. Nível atual: ${newLevel}/5\n\nPróximo passo: Posso sugerir um planejamento para amanhã à noite?`;
        break;
      }

      case 'LESS_PROACTIVE': {
        const profile = await getOrCreateProfile();
        const newLevel = Math.max(1, profile.proactivity_level - 1);
        await prisma.userProfile.update({ where: { id: profile.id }, data: { proactivity_level: newLevel } });
        responseText = `✅ Entendi: Reduzir proatividade.\n\n🧘 Feito: Vou ser menos insistente. Nível atual: ${newLevel}/5\n\nPróximo passo: Se eu estiver incomodando, você pode baixar para o nível 1.`;
        break;
      }

      case 'RESET_PREFS': {
        const profile = await getOrCreateProfile();
        await prisma.userProfile.update({
          where: { id: profile.id },
          data: { inferred_prefs: {}, confidence: {} },
        });
        responseText = '✅ Entendi: Resetar preferências.\n\n🔄 Feito: Preferências resetadas. Vou aprender seus hábitos do zero.\n\nPróximo passo: Continue usando normalmente para eu reaprender.';
        break;
      }

      case 'SEND_TO': {
        const contacts = parseContacts(process.env.WHATSAPP_CONTACTS ?? '');
        const contact = contacts.find(
          (c) => c.name.toLowerCase() === (args?.contactName ?? '').toLowerCase()
        );
        if (!contact) {
          responseText = `✅ Entendi: Você quer mandar uma mensagem para "${args?.contactName}".\n\n❌ Erro: "${args?.contactName}" não encontrado nos contatos.\n\nPróximo passo: Adicione-o na variável WHATSAPP_CONTACTS=nome:numero.`;
          break;
        }

        const comm = await prisma.communication.create({
          data: {
            provider: 'WHATSAPP',
            type: 'SEND',
            to: contact.phone,
            body: args?.message ?? '',
            status: 'AWAITING_APPROVAL',
            metadata: { contactName: contact.name, sender_id }
          }
        });

        responseText = `✅ Entendi: Enviar para ${contact.name}: "${args?.message}"\n\n⚠️  Aguardando: Esta é uma escrita externa. Digite "CONFIRMAR" para enviar.\n\nPróximo passo: Aguardo sua confirmação para prosseguir. (ID: ${comm.id.substring(0,8)})`;
        break;
      }

      case 'APPROVE': {
        const pending = await prisma.communication.findFirst({
          where: {
            status: 'AWAITING_APPROVAL',
            provider: 'WHATSAPP',
            metadata: { path: ['sender_id'], equals: sender_id }
          },
          orderBy: { created_at: 'desc' }
        });

        if (!pending) {
          responseText = '✅ Entendi: Você quer confirmar uma ação.\n\n❓ Atenção: Não encontrei nenhuma ação aguardando aprovação.\n\nPróximo passo: Tente enviar uma nova mensagem para alguém.';
          break;
        }

        await sendWhatsApp(pending.to!, pending.body!);
        await prisma.communication.update({
          where: { id: pending.id },
          data: { status: 'SENT', approved_at: new Date() }
        });

        responseText = `✅ Entendi: Confirmar envio para ${(pending.metadata as any)?.contactName ?? pending.to}.\n\n✉️  Feito: Mensagem enviada com sucesso!\n\nPróximo passo: Algo mais que eu possa fazer?`;
        break;
      }

      case 'UNKNOWN': {
        responseText =
          '✅ Entendi: Você enviou um comando.\n\n❓ Atenção: Não entendi o que deseja. Comandos disponíveis:\n• /hoje — resumo do dia\n• /done <id> — marcar como pronto\n• /adiar <id> tomorrow — adiar tarefa\n• /semana — agenda da semana\n• /email — resumo de e-mails\n• manda para <nome>: <msg>\n\nPróximo passo: Digite um dos comandos acima para continuar.';
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
