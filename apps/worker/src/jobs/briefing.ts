import prisma from '../lib/prisma';
import { isQuietHours } from '../lib/quietHours';
import { sendMessage } from '../lib/messenger';
import { format } from 'date-fns';
import { utcToZonedTime } from 'date-fns-tz';

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

  // Check daily nudge count (naive: count today's audit logs with action containing "nudge")
  const today = utcToZonedTime(new Date(), 'America/Sao_Paulo');
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

  // Get today's data (overdue + urgent tasks)
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

  const top3 = [...overdue, ...urgent].slice(0, 3);
  const topText =
    top3.length > 0
      ? top3.map((t) => `• ${t.title}`).join('\n')
      : '(nenhuma)';

  const text = `Bom dia! ☀️\n\nResumo do dia:\n• ${overdue.length} atrasados\n• ${urgent.length} urgentes\n\nTop 3:\n${topText}`;

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
