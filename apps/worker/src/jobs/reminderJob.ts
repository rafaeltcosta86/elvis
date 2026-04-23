import prisma from '../lib/prisma';
import { sendMessage } from '../lib/messenger';
import { utcToZonedTime } from 'date-fns-tz';
import Redis from 'ioredis';

const redis = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
});

export async function reminderJob(): Promise<void> {
  const TIMEZONE = 'America/Sao_Paulo';
  const ownerPhone = process.env.OWNER_PHONE || '551199999999';

  const reminders = await prisma.reminder.findMany({
    where: {
      status: 'SCHEDULED',
      remind_at: { lte: new Date() },
    },
    include: {
      task: true,
    },
  });

  for (const reminder of reminders) {
    if (!reminder.task) continue;

    // Update status to FIRED
    await prisma.reminder.update({
      where: { id: reminder.id },
      data: { status: 'FIRED' },
    });

    // Store snooze info in Redis
    const brtDate = utcToZonedTime(reminder.remind_at, TIMEZONE);
    await redis.set(
      `pending:snooze:${ownerPhone}`,
      JSON.stringify({
        reminderId: reminder.id,
        originalHour: brtDate.getHours(),
        originalMinute: brtDate.getMinutes(),
      }),
      'EX',
      3600 // 1h TTL
    );

    // Send WhatsApp message
    const message = `⏰ Lembrete: "${reminder.task.title}"\n\nComo quer adiar?\n1️⃣ 1 hora\n2️⃣ 4 horas\n3️⃣ Amanhã no mesmo horário`;
    await sendMessage(ownerPhone, message);

    // Log action
    await prisma.auditLog.create({
      data: {
        actor: 'system',
        action: 'reminder.fired',
        entity_type: 'Reminder',
        entity_id: reminder.id,
        summary: `Lembrete disparado para task: ${reminder.task.title}`,
      },
    });
  }
}
