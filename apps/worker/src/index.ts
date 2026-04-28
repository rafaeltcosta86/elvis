import Redis from 'ioredis';
import { initScheduler } from './lib/scheduler';
import { briefingJob } from './jobs/briefing';
import { checkinJob } from './jobs/checkin';
import { reviewJob } from './jobs/review';
import { emailSummaryJob } from './jobs/emailSummary';
import { weeklyReportJob } from './jobs/weeklyReport';
import { reminderJob } from './jobs/reminderJob';

const redis = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  retryStrategy: (times) => Math.min(times * 50, 2000),
});

redis.on('connect', async () => {
  console.log('worker ready');
  await initScheduler(briefingJob, checkinJob, reviewJob, emailSummaryJob, weeklyReportJob, reminderJob);
});

redis.on('error', (err) => {
  console.error('Redis connection error:', err);
});
