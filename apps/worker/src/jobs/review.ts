import prisma from '../lib/prisma';
import { isQuietHours } from '../lib/quietHours';
import { sendMessage } from '../lib/messenger';
import { utcToZonedTime } from 'date-fns-tz';

export async function reviewJob(): Promise<void> {
  const ownerPhone = process.env.OWNER_PHONE || '551199999999';

  // Check quiet hours
  if (isQuietHours()) {
    console.log('[SKIP quiet hours] review');
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
    console.log(`[SKIP limit] review (${todayNudges}/${dailyLimit} nudges today)`);
    return;
  }

  // Get completed today + still pending
  const completed = await prisma.task.count({
    where: { status: 'DONE' },
  });

  const pending = await prisma.task.count({
    where: { status: 'PENDING' },
  });

  const text = `Review do dia 📋\n\nConcluídas: ${completed}\nAinda pendentes: ${pending}\n\nParabéns pelo progresso! 🎉`;

  await sendMessage(ownerPhone, text);

  // Log nudge action
  await prisma.auditLog.create({
    data: {
      actor: 'system',
      action: 'nudge.review',
      entity_type: 'Job',
      entity_id: 'review',
      summary: 'Review enviado',
    },
  });
}
