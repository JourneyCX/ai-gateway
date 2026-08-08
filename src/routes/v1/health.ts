import type { FastifyInstance } from 'fastify';
import { getPool } from '../../db/postgres';
import { getRedis } from '../../db/redis';
import { register } from '../../utils/metrics';
import { config } from '../../config';

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/v1/health', async (_request, reply) => {
    const checks: Record<string, 'ok' | 'error'> = {};

    // PostgreSQL check
    try {
      await getPool().query('SELECT 1');
      checks.postgres = 'ok';
    } catch {
      checks.postgres = 'error';
    }

    // Redis check
    try {
      await getRedis().ping();
      checks.redis = 'ok';
    } catch {
      checks.redis = 'error';
    }

    const healthy = Object.values(checks).every((v) => v === 'ok');
    return reply.code(healthy ? 200 : 503).send({
      status: healthy ? 'ok' : 'degraded',
      checks,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  if (config.ENABLE_METRICS) {
    fastify.get('/v1/metrics', async (_request, reply) => {
      const metrics = await register.metrics();
      return reply
        .header('Content-Type', register.contentType)
        .code(200)
        .send(metrics);
    });
  }
}
