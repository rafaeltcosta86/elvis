import prisma from '../lib/prisma';
import { isQuietHours } from '../lib/quietHours';
import { sendMessage } from '../lib/messenger';
import { utcToZonedTime } from 'date-fns-tz';

export async function checkinJob(): Promise<void> {
  const ownerPhone = process.env.OWNER_PHONE || '551199999999';

  // Check quiet hours
  if (isQuietHours()) {
    console.log('[SKIP quiet hours] checkin');
    return;
  }

  // Get user profile and check nudge limit
  const userProfile = await prisma.userProfile.findFirst();
  if (!userProfile) {
    console.log('[SKIP] no user profile found');
    return;
  }

  // Check daily nudge count
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
    console.log(`[SKIP limit] checkin (${todayNudges}/${dailyLimit} nudges today)`);
    return;
  }

  // Find pending urgent tasks (anti-spam: skip if none)
  const urgentPending = await prisma.task.findMany({
    where: {
      status: 'PENDING',
      priority: 'URGENT',
    },
    take: 5,
  });

  if (urgentPending.length === 0) {
    console.log('[SKIP no pending urgent] checkin');
    return;
  }

  const taskList = urgentPending
    .map((t) => `• ${t.title}`)
    .join('\n');

  const text = `Check-in 13:30 ⏰\n\nAinda pendente:\n${taskList}\n\nQue tal começar agora?`;

  await sendMessage(ownerPhone, text);

  // Log nudge action
  await prisma.auditLog.create({
    data: {
      actor: 'system',
      action: 'nudge.checkin',
      entity_type: 'Job',
      entity_id: 'checkin',
      summary: 'Check-in enviado',
    },
  });
}
