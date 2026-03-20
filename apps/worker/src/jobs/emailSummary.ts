import prisma from '../lib/prisma';
import { isQuietHours } from '../lib/quietHours';
import { sendMessage } from '../lib/messenger';
import { utcToZonedTime } from 'date-fns-tz';

export async function emailSummaryJob(): Promise<void> {
  const ownerPhone = process.env.OWNER_PHONE || '551199999999';

  // Check quiet hours
  if (isQuietHours()) {
    console.log('[SKIP quiet hours] emailSummary');
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
    console.log(`[SKIP limit] emailSummary (${todayNudges}/${dailyLimit} nudges today)`);
    return;
  }

  // Mock: just count important emails
  const importantCount = 3; // mock data
  const text = `📧 Resumo de e-mails\n\nVocê tem ${importantCount} e-mails importantes pendentes.\n\nQuer revisá-los agora?`;

  await sendMessage(ownerPhone, text);

  // Log nudge action
  await prisma.auditLog.create({
    data: {
      actor: 'system',
      action: 'nudge.email',
      entity_type: 'Job',
      entity_id: 'emailSummary',
      summary: 'Email summary enviado',
    },
  });
}
