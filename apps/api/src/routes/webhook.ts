import { Router } from 'express';
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

// Validate Bearer token
function validateToken(authHeader?: string): boolean {
  if (!authHeader) return false;
  const [type, token] = authHeader.split(' ');
  if (type !== 'Bearer') return false;
  return token === process.env.WEBHOOK_SECRET;
}

router.post('/webhook/nanoclaw', async (req, res) => {
  try {
    // 1. Validate token
    const authHeader = req.headers.authorization;
    if (!validateToken(authHeader)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // 2. Parse request body
    const { sender_id, message_text, message_id, timestamp } = req.body;

    if (!sender_id || !message_text) {
      // Still return 200 to NanoClaw
      console.error('Invalid webhook payload');
      return res.json({ ok: true });
    }

    // 3. Parse command
    const { intent, args } = parseCommand(message_text);

    let responseText = '';

    // 4. Route by intent
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

      case 'CREATE_TASK': {
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

      case 'UNKNOWN': {
        responseText =
          'Não entendi. Comandos:\n/hoje — resumo\n/done <id> — pronto\n/adiar <id> tomorrow — adiar\n/semana — semana\n/email — e-mails';
        break;
      }
    }

    // 5. Send response via NanoClaw
    await sendWhatsApp(sender_id, responseText);

    // 6. Always return 200 to NanoClaw
    res.json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err);
    // Still return 200 to avoid redelivery
    res.json({ ok: true });
  }
});

export default router;
