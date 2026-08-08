import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticateRequest } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { tenantRateLimit } from '../../middleware/rateLimit';
import { enforceQuota } from '../../middleware/quota';
import { requestLogger } from '../../middleware/logging';
import { chatCompletion, DeepSeekError, GatewayTimeoutError } from '../../services/deepseek';
import { getCachedResponse, setCachedResponse } from '../../services/cache';
import { buildCostBreakdown } from '../../services/billing';
import { incrementQuotaCounters, recordDailySummary, logUsage, getQuotaStatus } from '../../services/usage';
import { requestsTotal, requestDuration, errorsTotal } from '../../utils/metrics';
import { logger } from '../../utils/logger';
import type { ChatCompletionRequest, Tenant } from '../../types';

const chatRequestSchema = z.object({
  model: z.string().min(1).default('deepseek-chat'),
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string(),
      })
    )
    .min(1),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().max(32_768).optional(),
  stream: z.literal(false).default(false),
  top_p: z.number().min(0).max(1).optional(),
  frequency_penalty: z.number().optional(),
  presence_penalty: z.number().optional(),
});

export async function chatRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post(
    '/v1/chat/completions',
    {
      preHandler: [
        authenticateRequest,
        resolveTenant,
        requestLogger,
        tenantRateLimit,
        enforceQuota,
      ],
    },
    async (request: FastifyRequest, reply) => {
      const tenant = request.tenant as Tenant;
      const tenantId = request.tenantId as number;
      const requestId = request.requestId ?? 'unknown';
      const startTime = Date.now();

      // Validate body
      const parsed = chatRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Invalid request body',
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const body = parsed.data as ChatCompletionRequest;
      const endTimer = requestDuration.startTimer({ tenant_id: String(tenantId), model: body.model });

      // ── 1. Cache check ───────────────────────────────────
      const cached = await getCachedResponse(tenantId, body.messages, body.model);
      if (cached) {
        endTimer();
        const quota = await getQuotaStatus(tenant);

        requestsTotal.inc({ tenant_id: String(tenantId), model: body.model, status: '200' });

        void logUsage({
          tenant_id: tenantId,
          request_id: requestId,
          model: body.model,
          prompt_tokens: cached.usage.prompt_tokens,
          completion_tokens: cached.usage.completion_tokens,
          total_tokens: cached.usage.total_tokens,
          cost_usd: 0,
          gateway_cost_usd: 0,
          tenant_charge_usd: 0,
          response_time_ms: Date.now() - startTime,
          cache_hit: true,
          status_code: 200,
        });

        return reply.code(200).send({
          ...cached,
          'x-tenant-usage': {
            current_month_queries: quota.queries_used,
            current_month_tokens: quota.tokens_used,
            monthly_quota_queries: quota.queries_limit,
            monthly_quota_tokens: quota.tokens_limit,
          },
        });
      }

      // ── 2. Call DeepSeek ─────────────────────────────────
      try {
        const response = await chatCompletion(body, tenantId);
        const responseTimeMs = Date.now() - startTime;

        const costs = buildCostBreakdown(response.usage, tenant.markup_multiplier, false);

        // ── 3. Update counters (non-blocking) ─────────────
        await Promise.all([
          incrementQuotaCounters(tenantId, response.usage.total_tokens),
          recordDailySummary(tenantId, response.usage.total_tokens, costs.tenant_charge_usd),
          setCachedResponse(tenantId, body.messages, body.model, response),
        ]);

        void logUsage({
          tenant_id: tenantId,
          request_id: requestId,
          model: body.model,
          prompt_tokens: response.usage.prompt_tokens,
          completion_tokens: response.usage.completion_tokens,
          total_tokens: response.usage.total_tokens,
          cost_usd: costs.gateway_cost_usd + costs.tenant_charge_usd,
          gateway_cost_usd: costs.gateway_cost_usd,
          tenant_charge_usd: costs.tenant_charge_usd,
          response_time_ms: responseTimeMs,
          cache_hit: false,
          status_code: 200,
        });

        endTimer();
        requestsTotal.inc({ tenant_id: String(tenantId), model: body.model, status: '200' });

        const quota = await getQuotaStatus(tenant);

        return reply.code(200).send({
          ...response,
          'x-tenant-usage': {
            current_month_queries: quota.queries_used,
            current_month_tokens: quota.tokens_used,
            monthly_quota_queries: quota.queries_limit,
            monthly_quota_tokens: quota.tokens_limit,
          },
        });
      } catch (err) {
        endTimer();
        const responseTimeMs = Date.now() - startTime;

        if (err instanceof GatewayTimeoutError) {
          errorsTotal.inc({ tenant_id: String(tenantId), error_type: 'timeout' });
          requestsTotal.inc({ tenant_id: String(tenantId), model: body.model, status: '503' });
          void logUsage({
            tenant_id: tenantId, request_id: requestId, model: body.model,
            prompt_tokens: 0, completion_tokens: 0, total_tokens: 0,
            cost_usd: 0, gateway_cost_usd: 0, tenant_charge_usd: 0,
            response_time_ms: responseTimeMs, cache_hit: false,
            status_code: 503, error_message: err.message,
          });
          return reply.code(503).send({ error: 'AI service request timed out. Please retry.' });
        }

        if (err instanceof DeepSeekError) {
          errorsTotal.inc({ tenant_id: String(tenantId), error_type: 'deepseek_error' });
          requestsTotal.inc({ tenant_id: String(tenantId), model: body.model, status: '500' });
          void logUsage({
            tenant_id: tenantId, request_id: requestId, model: body.model,
            prompt_tokens: 0, completion_tokens: 0, total_tokens: 0,
            cost_usd: 0, gateway_cost_usd: 0, tenant_charge_usd: 0,
            response_time_ms: responseTimeMs, cache_hit: false,
            status_code: 500, error_message: err.message,
          });
          return reply.code(500).send({ error: 'AI service temporarily unavailable.' });
        }

        logger.error({ err, tenantId, requestId }, 'Unexpected chat error');
        errorsTotal.inc({ tenant_id: String(tenantId), error_type: 'unexpected' });
        return reply.code(500).send({ error: 'Internal server error' });
      }
    }
  );
}
