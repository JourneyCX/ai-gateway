import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import staticFiles from '@fastify/static';
import { join } from 'path';
import { healthRoutes } from './routes/v1/health';
import { chatRoutes } from './routes/v1/chat';
import { tenantRoutes } from './routes/v1/tenant';
import { adminRoutes } from './routes/v1/admin';
import { logger } from './utils/logger';
import { activeTenants } from './utils/metrics';
import { countActiveTenants } from './models/tenant';

export async function buildServer() {
  const fastify = Fastify({
    logger: false, // We use pino directly
    requestIdHeader: 'x-request-id',
    trustProxy: true,
  });

  // ── Security headers ─────────────────────────────────────
  await fastify.register(helmet, {
    contentSecurityPolicy: false, // Admin panel loads CDN assets
  });

  // ── CORS (service-to-service — lock down in prod) ────────
  await fastify.register(cors, {
    origin: process.env.ALLOWED_ORIGINS?.split(',') ?? false,
  });

  // ── Static files — serve public/ at /admin/* ─────────────
  await fastify.register(staticFiles, {
    root: join(__dirname, '..', 'public'),
    prefix: '/admin/',
    decorateReply: false,
  });

  // Redirect /admin → /admin/admin.html
  fastify.get('/admin', (_request, reply) => {
    reply.redirect('/admin/admin.html');
  });

  // ── Routes ───────────────────────────────────────────────
  await fastify.register(healthRoutes);
  await fastify.register(chatRoutes);
  await fastify.register(tenantRoutes);
  await fastify.register(adminRoutes);

  // ── Global error handler ─────────────────────────────────
  fastify.setErrorHandler((error, request, reply) => {
    logger.error({ error, url: request.url }, 'Unhandled error');
    reply.code(500).send({ error: 'Internal server error' });
  });

  // ── 404 handler ──────────────────────────────────────────
  fastify.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({ error: 'Route not found' });
  });

  // ── Warm up active-tenant gauge ──────────────────────────
  setInterval(async () => {
    try {
      const count = await countActiveTenants();
      activeTenants.set(count);
    } catch { /* non-critical */ }
  }, 60_000);

  return fastify;
}
