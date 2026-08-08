import type { FastifyInstance, FastifyRequest } from 'fastify';
import { authenticateAdmin } from '../../middleware/auth';
import { query, queryOne } from '../../db/postgres';
import { getPool } from '../../db/postgres';
import { getRedis } from '../../db/redis';

export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  // ── GET /v1/admin/stats ───────────────────────────────────
  // System-wide summary: tenant counts + today's totals
  fastify.get(
    '/v1/admin/stats',
    { preHandler: [authenticateAdmin] },
    async (_request, reply) => {
      const [tenantStats, todayStats, errorStats] = await Promise.all([
        queryOne<{
          total_tenants: string;
          active_tenants: string;
        }>(`
          SELECT
            COUNT(*)::text                             AS total_tenants,
            COUNT(*) FILTER (WHERE is_enabled)::text  AS active_tenants
          FROM tenants
        `),

        queryOne<{
          today_requests: string;
          today_tokens: string;
          today_revenue: string;
          today_cache_hits: string;
          avg_response_ms: string;
        }>(`
          SELECT
            COUNT(*)::text                                   AS today_requests,
            COALESCE(SUM(total_tokens), 0)::text             AS today_tokens,
            COALESCE(SUM(tenant_charge_usd), 0)::text        AS today_revenue,
            COUNT(*) FILTER (WHERE cache_hit)::text          AS today_cache_hits,
            COALESCE(AVG(response_time_ms), 0)::text         AS avg_response_ms
          FROM usage_logs
          WHERE created_at >= CURRENT_DATE
            AND status_code = 200
        `),

        queryOne<{
          error_requests: string;
          timeout_requests: string;
        }>(`
          SELECT
            COUNT(*) FILTER (WHERE status_code >= 500)::text AS error_requests,
            COUNT(*) FILTER (WHERE status_code = 503)::text  AS timeout_requests
          FROM usage_logs
          WHERE created_at >= CURRENT_DATE
        `),
      ]);

      const todayReq  = parseInt(todayStats?.today_requests  ?? '0', 10);
      const cacheHits = parseInt(todayStats?.today_cache_hits ?? '0', 10);

      return reply.code(200).send({
        tenants: {
          total:  parseInt(tenantStats?.total_tenants  ?? '0', 10),
          active: parseInt(tenantStats?.active_tenants ?? '0', 10),
        },
        today: {
          requests:        todayReq,
          tokens:          parseInt(todayStats?.today_tokens ?? '0', 10),
          revenue_usd:     parseFloat(todayStats?.today_revenue ?? '0'),
          cache_hits:      cacheHits,
          cache_hit_rate:  todayReq > 0 ? +(cacheHits / todayReq).toFixed(4) : 0,
          avg_response_ms: Math.round(parseFloat(todayStats?.avg_response_ms ?? '0')),
        },
        errors: {
          server_errors:  parseInt(errorStats?.error_requests   ?? '0', 10),
          timeouts:       parseInt(errorStats?.timeout_requests ?? '0', 10),
        },
      });
    }
  );

  // ── GET /v1/admin/tenants ─────────────────────────────────
  // All tenants enriched with current-month usage
  fastify.get(
    '/v1/admin/tenants',
    { preHandler: [authenticateAdmin] },
    async (_request, reply) => {
      const rows = await query<{
        id: number;
        tenant_id: number;
        is_enabled: boolean;
        subscription_tier: string;
        monthly_query_limit: number;
        monthly_token_limit: number;
        markup_multiplier: number;
        created_at: string;
        updated_at: string;
        month_queries: string;
        month_tokens: string;
        month_revenue: string;
      }>(`
        SELECT
          t.*,
          COALESCE(u.month_queries, 0)::text  AS month_queries,
          COALESCE(u.month_tokens,  0)::text  AS month_tokens,
          COALESCE(u.month_revenue, 0)::text  AS month_revenue
        FROM tenants t
        LEFT JOIN (
          SELECT
            tenant_id,
            COUNT(*)                    AS month_queries,
            SUM(total_tokens)           AS month_tokens,
            SUM(tenant_charge_usd)      AS month_revenue
          FROM usage_logs
          WHERE TO_CHAR(created_at, 'YYYY-MM') = TO_CHAR(NOW(), 'YYYY-MM')
            AND status_code = 200
          GROUP BY tenant_id
        ) u ON t.tenant_id = u.tenant_id
        ORDER BY t.created_at DESC
      `);

      const tenants = rows.map((r) => ({
        ...r,
        month_queries: parseInt(r.month_queries, 10),
        month_tokens:  parseInt(r.month_tokens,  10),
        month_revenue: parseFloat(r.month_revenue),
        queries_pct: r.monthly_query_limit > 0
          ? +(parseInt(r.month_queries, 10) / r.monthly_query_limit).toFixed(4)
          : 0,
        tokens_pct: r.monthly_token_limit > 0
          ? +(parseInt(r.month_tokens, 10) / r.monthly_token_limit).toFixed(4)
          : 0,
      }));

      return reply.code(200).send({ tenants });
    }
  );

  // ── GET /v1/admin/usage/daily ─────────────────────────────
  // Last N days of daily system-wide usage (for charts)
  fastify.get(
    '/v1/admin/usage/daily',
    { preHandler: [authenticateAdmin] },
    async (request: FastifyRequest, reply) => {
      const days = Math.min(parseInt((request.query as Record<string, string>).days ?? '30', 10), 90);

      const rows = await query<{
        day: string;
        requests: string;
        tokens: string;
        revenue: string;
        cache_hits: string;
        errors: string;
      }>(`
        SELECT
          TO_CHAR(created_at, 'YYYY-MM-DD')           AS day,
          COUNT(*)::text                               AS requests,
          COALESCE(SUM(total_tokens), 0)::text         AS tokens,
          COALESCE(SUM(tenant_charge_usd), 0)::text    AS revenue,
          COUNT(*) FILTER (WHERE cache_hit)::text      AS cache_hits,
          COUNT(*) FILTER (WHERE status_code >= 500)::text AS errors
        FROM usage_logs
        WHERE created_at >= CURRENT_DATE - ($1 || ' days')::INTERVAL
        GROUP BY day
        ORDER BY day
      `, [days]);

      return reply.code(200).send({
        days,
        data: rows.map((r) => ({
          day:        r.day,
          requests:   parseInt(r.requests,   10),
          tokens:     parseInt(r.tokens,     10),
          revenue:    parseFloat(r.revenue),
          cache_hits: parseInt(r.cache_hits, 10),
          errors:     parseInt(r.errors,     10),
        })),
      });
    }
  );

  // ── GET /v1/admin/usage/by-tenant ─────────────────────────
  // Top tenants for the current month (for revenue breakdown chart)
  fastify.get(
    '/v1/admin/usage/by-tenant',
    { preHandler: [authenticateAdmin] },
    async (_request, reply) => {
      const rows = await query<{
        tenant_id: string;
        requests: string;
        tokens: string;
        revenue: string;
      }>(`
        SELECT
          tenant_id::text                          AS tenant_id,
          COUNT(*)::text                           AS requests,
          COALESCE(SUM(total_tokens), 0)::text     AS tokens,
          COALESCE(SUM(tenant_charge_usd), 0)::text AS revenue
        FROM usage_logs
        WHERE TO_CHAR(created_at, 'YYYY-MM') = TO_CHAR(NOW(), 'YYYY-MM')
          AND status_code = 200
        GROUP BY tenant_id
        ORDER BY SUM(tenant_charge_usd) DESC
        LIMIT 15
      `);

      return reply.code(200).send({
        data: rows.map((r) => ({
          tenant_id: parseInt(r.tenant_id, 10),
          requests:  parseInt(r.requests,  10),
          tokens:    parseInt(r.tokens,    10),
          revenue:   parseFloat(r.revenue),
        })),
      });
    }
  );

  // ── GET /v1/admin/health/detail ───────────────────────────
  // Extended health including recent error log + Redis info
  fastify.get(
    '/v1/admin/health/detail',
    { preHandler: [authenticateAdmin] },
    async (_request, reply) => {
      const [pgOk, redisInfo, recentErrors] = await Promise.allSettled([
        getPool().query('SELECT version() AS v'),
        getRedis().info('server'),
        query<{ status_code: number; error_message: string; created_at: string; count: string }>(`
          SELECT
            status_code,
            COALESCE(error_message, 'unknown') AS error_message,
            MAX(created_at)::text              AS created_at,
            COUNT(*)::text                     AS count
          FROM usage_logs
          WHERE created_at >= NOW() - INTERVAL '1 hour'
            AND status_code >= 400
          GROUP BY status_code, error_message
          ORDER BY MAX(created_at) DESC
          LIMIT 10
        `),
      ]);

      const pgVersion = pgOk.status === 'fulfilled'
        ? (pgOk.value.rows[0] as { v: string }).v
        : null;

      // Extract Redis version from INFO output
      let redisVersion: string | null = null;
      if (redisInfo.status === 'fulfilled') {
        const match = (redisInfo.value as string).match(/redis_version:(.+)/);
        redisVersion = match ? match[1].trim() : null;
      }

      return reply.code(200).send({
        postgres: {
          status: pgOk.status === 'fulfilled' ? 'ok' : 'error',
          version: pgVersion,
        },
        redis: {
          status: redisInfo.status === 'fulfilled' ? 'ok' : 'error',
          version: redisVersion,
        },
        recent_errors: recentErrors.status === 'fulfilled' ? recentErrors.value : [],
      });
    }
  );
}
