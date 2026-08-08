import { query } from '../db/postgres';
import type { UsageLog } from '../types';

export async function insertUsageLog(log: Omit<UsageLog, 'id' | 'created_at'>): Promise<void> {
  await query(
    `INSERT INTO usage_logs
       (tenant_id, request_id, model, prompt_tokens, completion_tokens, total_tokens,
        cost_usd, gateway_cost_usd, tenant_charge_usd, response_time_ms,
        cache_hit, status_code, error_message)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      log.tenant_id,
      log.request_id,
      log.model,
      log.prompt_tokens,
      log.completion_tokens,
      log.total_tokens,
      log.cost_usd,
      log.gateway_cost_usd,
      log.tenant_charge_usd,
      log.response_time_ms,
      log.cache_hit,
      log.status_code,
      log.error_message ?? null,
    ]
  );
}

export async function getRecentLogs(tenantId: number, limit = 50): Promise<UsageLog[]> {
  return query<UsageLog>(
    `SELECT * FROM usage_logs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [tenantId, limit]
  );
}

export async function getDailyBreakdown(
  tenantId: number,
  yearMonth: string
): Promise<Array<{ day: string; queries: number; tokens: number; cost_usd: number }>> {
  return query<{ day: string; queries: number; tokens: number; cost_usd: number }>(
    `SELECT
       TO_CHAR(created_at, 'YYYY-MM-DD') AS day,
       COUNT(*)::int                     AS queries,
       COALESCE(SUM(total_tokens), 0)::int AS tokens,
       COALESCE(SUM(tenant_charge_usd), 0)::float AS cost_usd
     FROM usage_logs
     WHERE tenant_id = $1
       AND TO_CHAR(created_at, 'YYYY-MM') = $2
       AND status_code = 200
     GROUP BY day
     ORDER BY day`,
    [tenantId, yearMonth]
  );
}
