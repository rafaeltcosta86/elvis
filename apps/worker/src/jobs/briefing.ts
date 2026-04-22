import prisma from '../lib/prisma';
import { isQuietHours } from '../lib/quietHours';
import { sendMessage } from '../lib/messenger';
import { utcToZonedTime, format as formatTz } from 'date-fns-tz';
import { getToken } from '../lib/oauthService';
import { getCalendarEventsForToday } from '@shared';

export async function briefingJob(): Promise<void> {
  const ownerPhone = process.env.OWNER_PHONE || '551199999999';

  // Check quiet hours
  if (isQuietHours()) {
    console.log('[SKIP quiet hours] briefing');
    return;
  }

  // Get user profile and check nudge limit
  const userProfile = await prisma.userProfile.findFirst();
  if (!userProfile) {
    console.log('[SKIP] no user profile found');
    return;
  }

  // Check daily nudge count
  const timezone = 'America/Sao_Paulo';
  const today = utcToZonedTime(new Date(), timezone);
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  const todayNudges = await prisma.auditLog.count({
    where: {
      action: { contains: 'nudge' },
      ts: { gte: startOfDay, lt: endOfDay },
    },
  });

  const dailyLimit = userProfile.daily_nudge_limit || 5;
  if (todayNudges >= dailyLimit) {
    console.log(`[SKIP limit] briefing (${todayNudges}/${dailyLimit} nudges today)`);
    return;
  }

  // 1. Calendar Events
  let calendarText = '';
  let calendarWarning = '';
  try {
    const token = await getToken();
    if (token) {
      const events = await getCalendarEventsForToday(token);
      if (events.length > 0) {
        calendarText = '📅 Compromissos de hoje:\n' +
          events.map(e => {
            const zonedStart = utcToZonedTime(new Date(e.start), timezone);
            const startTime = formatTz(zonedStart, 'HH:mm', { timeZone: timezone });
            return `• ${startTime} — ${e.title} (${e.durationText})`;
          }).join('\n') + '\n\n';
      }
    } else {
      calendarWarning = '📅 Calendário não configurado. Execute o OAuth bootstrap no servidor para habilitar.\n\n';
    }
  } catch (error) {
    console.error('Error fetching calendar events:', error);
    calendarWarning = '📅 Calendário não configurado. Execute o OAuth bootstrap no servidor para habilitar.\n\n';
  }

  // 2. Tasks
  const tasks = await prisma.task.findMany({
    where: { status: { in: ['PENDING', 'IN_PROGRESS'] } },
  });

  const todayDate = new Date(startOfDay);
  const overdue = tasks.filter((t) => t.due_at && t.due_at < todayDate);
  const urgent = tasks.filter(
    (t) =>
      t.priority === 'URGENT' ||
      (t.due_at && t.due_at >= todayDate && t.due_at < endOfDay)
  );

  // Deduplicate and get top 3
  const combined = [...overdue, ...urgent];
  const uniqueTasks = combined.filter((v, i, a) => a.findIndex(t => t.id === v.id) === i);
  const top3 = uniqueTasks.slice(0, 3);

  const top3Text = top3.length > 0
    ? `Top 3: ${top3.map(t => t.title).join(' · ')}`
    : 'Top 3: (nenhuma)';

  const tasksText = `✅ Tarefas: ${overdue.length} atrasadas · ${urgent.length} urgentes\n${top3Text}`;

  const text = `Bom dia! ☀️\n${calendarText}${calendarWarning}${tasksText}`;

  await sendMessage(ownerPhone, text);

  // Log nudge action
  await prisma.auditLog.create({
    data: {
      actor: 'system',
      action: 'nudge.briefing',
      entity_type: 'Job',
      entity_id: 'briefing',
      summary: 'Briefing enviado',
    },
  });
}
