import type { FastifyRequest, FastifyReply } from 'fastify';
import { getRedis } from '../db/redis';
import { config } from '../config';

/**
 * Token-bucket rate limiter stored in Redis.
 * Bucket capacity = RATE_LIMIT_RPM + RATE_LIMIT_BURST.
 * Refills at RATE_LIMIT_RPM tokens per minute.
 */
export async function tenantRateLimit(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const tenantId = request.tenantId;
  if (!tenantId) return; // tenant middleware runs first

  const now = Date.now();
  const redis = getRedis();
  const tokensKey = `ratelimit:${tenantId}:tokens`;
  const lastRefillKey = `ratelimit:${tenantId}:last_refill`;

  // Lua script for atomic token-bucket check
  const luaScript = `
    local tokens_key = KEYS[1]
    local last_key = KEYS[2]
    local capacity = tonumber(ARGV[1])
    local refill_rate = tonumber(ARGV[2])
    local now = tonumber(ARGV[3])
    local cost = tonumber(ARGV[4])

    local last = tonumber(redis.call('GET', last_key) or now)
    local elapsed_ms = now - last
    local elapsed_min = elapsed_ms / 60000

    local current = tonumber(redis.call('GET', tokens_key) or capacity)
    local refilled = math.min(capacity, current + elapsed_min * refill_rate)

    if refilled < cost then
      return {0, math.ceil((cost - refilled) / refill_rate * 60), refilled}
    end

    local new_tokens = refilled - cost
    redis.call('SETEX', tokens_key, 120, new_tokens)
    redis.call('SETEX', last_key, 120, now)
    return {1, 0, new_tokens}
  `;

  const capacity = config.RATE_LIMIT_RPM + config.RATE_LIMIT_BURST;
  const result = (await redis.eval(
    luaScript,
    2,
    tokensKey,
    lastRefillKey,
    capacity,
    config.RATE_LIMIT_RPM,
    now,
    1
  )) as [number, number, number];

  const allowed = result[0] === 1;
  const retryAfterSeconds = result[1];

  if (!allowed) {
    reply.header('Retry-After', String(retryAfterSeconds));
    await reply.code(429).send({
      error: `Rate limit exceeded. Try again in ${retryAfterSeconds} seconds.`,
      retry_after: retryAfterSeconds,
    });
  }
}
