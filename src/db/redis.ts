import Redis from 'ioredis';
import { config } from '../config';
import { logger } from '../utils/logger';

let redisClient: Redis;

export function getRedis(): Redis {
  if (!redisClient) {
    redisClient = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
    });

    redisClient.on('connect', () => logger.info('Redis connected'));
    redisClient.on('error', (err) => logger.error({ err }, 'Redis error'));
    redisClient.on('close', () => logger.warn('Redis connection closed'));
  }
  return redisClient;
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    logger.info('Redis connection closed');
  }
}

// ── Helpers ─────────────────────────────────────────────────

export async function redisGet(key: string): Promise<string | null> {
  return getRedis().get(key);
}

export async function redisSet(key: string, value: string, ttlSeconds?: number): Promise<void> {
  const redis = getRedis();
  if (ttlSeconds) {
    await redis.set(key, value, 'EX', ttlSeconds);
  } else {
    await redis.set(key, value);
  }
}

export async function redisIncr(key: string): Promise<number> {
  return getRedis().incr(key);
}

export async function redisExpireAt(key: string, timestamp: number): Promise<void> {
  await getRedis().expireat(key, timestamp);
}

export async function redisHIncrBy(key: string, field: string, amount: number): Promise<number> {
  return getRedis().hincrby(key, field, amount);
}

export async function redisHSet(key: string, data: Record<string, string | number>): Promise<void> {
  await getRedis().hset(key, data);
}

export async function redisExpire(key: string, ttlSeconds: number): Promise<void> {
  await getRedis().expire(key, ttlSeconds);
}

export async function redisDel(key: string): Promise<void> {
  await getRedis().del(key);
}
