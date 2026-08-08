import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticateRequest, authenticateAdmin } from '../../middleware/auth';
import {
  findTenantById,
  updateTenantQuota,
  updateTenantMarkup,
  setTenantEnabled,
  getMonthlyUsageSummary,
} from '../../models/tenant';
import { getQuotaStatus } from '../../services/usage';
import { getDailyBreakdown } from '../../models/usageLog';

const tenantIdParam = z.object({ tenantId: z.coerce.number().int().positive() });

export async function tenantRoutes(fastify: FastifyInstance): Promise<void> {
  // ── GET /v1/tenant/:tenantId/usage ───────────────────────
  fastify.get(
    '/v1/tenant/:tenantId/usage',
    { preHandler: [authenticateRequest] },
    async (request: FastifyRequest, reply) => {
      const params = tenantIdParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid tenantId' });

      const { tenantId } = params.data;
      const tenant = await findTenantById(tenantId);
      if (!tenant) return reply.code(404).send({ error: 'Tenant not found' });

      const yearMonth = new Date().toISOString().slice(0, 7);
      const [summary, daily] = await Promise.all([
        getMonthlyUsageSummary(tenantId, yearMonth),
        getDailyBreakdown(tenantId, yearMonth),
      ]);

      return reply.code(200).send({
        tenant_id: tenantId,
        period: yearMonth,
        total_queries: summary.total_queries,
        total_tokens: summary.total_tokens,
        total_cost_usd: summary.total_cost_usd,
        daily_breakdown: daily,
      });
    }
  );

  // ── GET /v1/tenant/:tenantId/quota ───────────────────────
  fastify.get(
    '/v1/tenant/:tenantId/quota',
    { preHandler: [authenticateRequest] },
    async (request: FastifyRequest, reply) => {
      const params = tenantIdParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid tenantId' });

      const { tenantId } = params.data;
      const tenant = await findTenantById(tenantId);
      if (!tenant) return reply.code(404).send({ error: 'Tenant not found' });

      const status = await getQuotaStatus(tenant);

      return reply.code(200).send({
        tenant_id: tenantId,
        subscription_tier: tenant.subscription_tier,
        queries: {
          used: status.queries_used,
          limit: status.queries_limit,
          remaining: Math.max(0, status.queries_limit - status.queries_used),
          exceeded: status.queries_exceeded,
        },
        tokens: {
          used: status.tokens_used,
          limit: status.tokens_limit,
          remaining: Math.max(0, status.tokens_limit - status.tokens_used),
          exceeded: status.tokens_exceeded,
        },
      });
    }
  );

  // ── PUT /v1/tenant/:tenantId/quota (admin) ────────────────
  const quotaUpdateSchema = z.object({
    monthly_query_limit: z.number().int().positive(),
    monthly_token_limit: z.number().int().positive(),
  });

  fastify.put(
    '/v1/tenant/:tenantId/quota',
    { preHandler: [authenticateAdmin] },
    async (request: FastifyRequest, reply) => {
      const params = tenantIdParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid tenantId' });

      const body = quotaUpdateSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: 'Invalid body', details: body.error.flatten() });
      }

      const { tenantId } = params.data;
      const updated = await updateTenantQuota(
        tenantId,
        body.data.monthly_query_limit,
        body.data.monthly_token_limit
      );

      if (!updated) return reply.code(404).send({ error: 'Tenant not found' });
      return reply.code(200).send(updated);
    }
  );

  // ── PUT /v1/tenant/:tenantId/markup (admin) ───────────────
  const markupSchema = z.object({ markup_multiplier: z.number().positive() });

  fastify.put(
    '/v1/tenant/:tenantId/markup',
    { preHandler: [authenticateAdmin] },
    async (request: FastifyRequest, reply) => {
      const params = tenantIdParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid tenantId' });

      const body = markupSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: 'Invalid body', details: body.error.flatten() });
      }

      const updated = await updateTenantMarkup(params.data.tenantId, body.data.markup_multiplier);
      if (!updated) return reply.code(404).send({ error: 'Tenant not found' });
      return reply.code(200).send(updated);
    }
  );

  // ── PUT /v1/tenant/:tenantId/status (admin) ───────────────
  const statusSchema = z.object({ is_enabled: z.boolean() });

  fastify.put(
    '/v1/tenant/:tenantId/status',
    { preHandler: [authenticateAdmin] },
    async (request: FastifyRequest, reply) => {
      const params = tenantIdParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid tenantId' });

      const body = statusSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: 'Invalid body', details: body.error.flatten() });
      }

      const updated = await setTenantEnabled(params.data.tenantId, body.data.is_enabled);
      if (!updated) return reply.code(404).send({ error: 'Tenant not found' });
      return reply.code(200).send(updated);
    }
  );
}
