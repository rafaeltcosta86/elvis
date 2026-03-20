import { Router } from 'express';
import prisma from '../lib/prisma';
import redis from '../lib/redis';

const router = Router();
const startTime = Date.now();

router.get('/status', async (_req, res) => {
  let dbStatus = 'error';
  let redisStatus = 'error';

  // Check database
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = 'ok';
  } catch (err) {
    console.error('DB check failed:', err);
  }

  // Check redis
  try {
    await redis.ping();
    redisStatus = 'ok';
  } catch (err) {
    console.error('Redis check failed:', err);
  }

  const uptime = Math.floor((Date.now() - startTime) / 1000);

  res.json({
    version: '0.0.1',
    uptime,
    db: dbStatus,
    redis: redisStatus,
  });
});

export default router;
