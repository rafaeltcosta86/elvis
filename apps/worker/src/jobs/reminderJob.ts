import { sendWhatsApp } from '../lib/nanoclawClient';
import { utcToZonedTime } from 'date-fns-tz';
import prisma from '../lib/prisma';
import Redis from 'ioredis';

const redis = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
});

const TIMEZONE = 'America/Sao_Paulo';

export async function reminderJob() {
  const now = new Date();
  const OWNER_PHONE = process.env.OWNER_PHONE || '';

  const dueReminders = await prisma.reminder.findMany({
    where: {
      status: 'SCHEDULED',
      remind_at: { lte: now },
    },
    include: {
      task: true,
    },
  });

  for (const reminder of dueReminders) {
    try {
      await prisma.reminder.update({
        where: { id: reminder.id },
        data: { status: 'FIRED' },
      });

      const taskTitle = reminder.task?.title || 'Tarefa sem título';
      const message = `⏰ Lembrete: "${taskTitle}"\n\nComo quer adiar?\n1️⃣ 1 hora\n2️⃣ 4 horas\n3️⃣ Amanhã no mesmo horário`;

      if (OWNER_PHONE) {
        await sendWhatsApp(OWNER_PHONE, message);

        const brtDate = utcToZonedTime(reminder.remind_at, TIMEZONE);
        const snoozeInfo = {
          reminderId: reminder.id,
          originalHour: brtDate.getHours(),
          originalMinute: brtDate.getMinutes(),
        };

        await redis.set(
          `pending:snooze:${OWNER_PHONE}`,
          JSON.stringify(snoozeInfo),
          'EX',
          3600 // 1h TTL
        );
      }
    } catch (err) {
      console.error(`Error processing reminder ${reminder.id}:`, err);
    }
  }
}
