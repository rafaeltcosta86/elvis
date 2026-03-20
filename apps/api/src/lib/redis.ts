import Redis from 'ioredis';

let redis: Redis;

if (process.env.NODE_ENV === 'production') {
  redis = new Redis({
    host: process.env.REDIS_HOST || 'redis',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  });
} else {
  const globalForRedis = global as unknown as { redis: Redis };
  if (!globalForRedis.redis) {
    globalForRedis.redis = new Redis({
      host: process.env.REDIS_HOST || 'redis',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      retryStrategy: (times) => Math.min(times * 50, 2000),
    });
  }
  redis = globalForRedis.redis;
}

export default redis;
