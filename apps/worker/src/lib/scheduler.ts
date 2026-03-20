import { Queue, Worker } from 'bullmq';
import { onJobFailed, checkQueueHealth } from './alertService';

const redisConnection = {
  host: process.env.REDIS_HOST || 'redis',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
};

export const schedulerQueue = new Queue('scheduler', { connection: redisConnection });

export async function initScheduler(
  briefingHandler: (job: any) => Promise<void>,
  checkinHandler: (job: any) => Promise<void>,
  reviewHandler: (job: any) => Promise<void>,
  emailHandler: (job: any) => Promise<void>,
  weeklyReportHandler: (job: any) => Promise<void>
): Promise<Worker> {
  // Create worker
  const worker = new Worker('scheduler', async (job) => {
    if (process.env.JOBS_ENABLED === 'false') {
      console.log('[SKIP] jobs disabled via JOBS_ENABLED=false');
      return;
    }

    switch (job.name) {
      case 'briefing':
        await briefingHandler(job);
        break;
      case 'checkin':
        await checkinHandler(job);
        break;
      case 'review':
        await reviewHandler(job);
        break;
      case 'emailSummary':
        await emailHandler(job);
        break;
      case 'weeklyReport':
        await weeklyReportHandler(job);
        break;
      case 'queueHealthCheck':
        await checkQueueHealth();
        break;
      default:
        console.log(`unknown job: ${job.name}`);
    }
  }, { connection: redisConnection });

  worker.on('completed', (job) => {
    console.log(`job completed: ${job.name}`);
  });

  worker.on('failed', (job, err) => {
    console.error(`job failed: ${job?.name}`, err);
    void onJobFailed(job?.name, err);
  });

  // Register cron jobs (timezone: America/Sao_Paulo)
  await schedulerQueue.add(
    'briefing',
    {},
    {
      repeat: {
        pattern: '30 7 * * *', // 07:30 every day
        tz: 'America/Sao_Paulo',
      },
      removeOnComplete: true,
    }
  );

  await schedulerQueue.add(
    'checkin',
    {},
    {
      repeat: {
        pattern: '30 13 * * *', // 13:30 every day
        tz: 'America/Sao_Paulo',
      },
      removeOnComplete: true,
    }
  );

  await schedulerQueue.add(
    'review',
    {},
    {
      repeat: {
        pattern: '0 20 * * *', // 20:00 every day
        tz: 'America/Sao_Paulo',
      },
      removeOnComplete: true,
    }
  );

  await schedulerQueue.add(
    'emailSummary',
    {},
    {
      repeat: {
        pattern: '0 18 * * *', // 18:00 every day
        tz: 'America/Sao_Paulo',
      },
      removeOnComplete: true,
    }
  );

  await schedulerQueue.add(
    'weeklyReport',
    {},
    {
      repeat: {
        pattern: '0 20 * * 0', // 20:00 every Sunday
        tz: 'America/Sao_Paulo',
      },
      removeOnComplete: true,
    }
  );

  await schedulerQueue.add(
    'queueHealthCheck',
    {},
    {
      repeat: {
        pattern: '0 * * * *', // every hour
        tz: 'America/Sao_Paulo',
      },
      removeOnComplete: true,
    }
  );

  console.log('scheduler initialized');
  console.log('6 cron jobs registered: briefing (07:30), checkin (13:30), review (20:00), emailSummary (18:00), weeklyReport (Sun 20:00), queueHealthCheck (hourly)');

  return worker;
}
