import { Router } from 'express';
import { Queue } from 'bullmq';

const router = Router();

const redisConnection = {
  host: process.env.REDIS_HOST || 'redis',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
};

const schedulerQueue = new Queue('scheduler', {
  connection: redisConnection,
});

router.post('/jobs/:name/trigger', async (req, res) => {
  try {
    const { name } = req.params;

    // Validate job name
    const validNames = ['briefing', 'checkin', 'review', 'emailSummary'];
    if (!validNames.includes(name)) {
      return res.status(400).json({
        error: `Invalid job name. Valid names: ${validNames.join(', ')}`,
      });
    }

    // Add immediate job to queue
    const job = await schedulerQueue.add(name, {}, { removeOnComplete: true });

    res.json({
      status: 'triggered',
      jobId: job.id,
      jobName: name,
    });
  } catch (err) {
    console.error('POST /jobs/:name/trigger error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
