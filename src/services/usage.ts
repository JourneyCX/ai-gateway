import { redisIncr, redisExpireAt, redisHIncrBy, redisHSet, redisExpire } from '../db/redis';
import { insertUsageLog } from '../models/usageLog';
import { quotaRemaining, tokensTotal } from '../utils/metrics';
import { roundUsd } from './billing';
import type { UsageLog, Tenant, QuotaStatus } from '../types';

function monthKey(tenantId: number, suffix: 'queries' | 'tokens'): string {
  const ym = new Date().toISOString().slice(0, 7); // YYYY-MM
  return `quota:${tenantId}:${suffix}:${ym}`;
}

function endOfMonthTimestamp(): number {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
  return Math.floor(end.getTime() / 1000);
}

function dailyKey(tenantId: number): string {
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `daily:${tenantId}:${day}`;
}

export async function getQuotaStatus(tenant: Tenant): Promise<QuotaStatus> {
  const [qStr, tStr] = await Promise.all([
    import('../db/redis').then((r) => r.redisGet(monthKey(tenant.tenant_id, 'queries'))),
    import('../db/redis').then((r) => r.redisGet(monthKey(tenant.tenant_id, 'tokens'))),
  ]);

  const queries_used = qStr ? parseInt(qStr, 10) : 0;
  const tokens_used = tStr ? parseInt(tStr, 10) : 0;

  return {
    queries_used,
    tokens_used,
    queries_limit: tenant.monthly_query_limit,
    tokens_limit: tenant.monthly_token_limit,
    queries_exceeded: queries_used >= tenant.monthly_query_limit,
    tokens_exceeded: tokens_used >= tenant.monthly_token_limit,
  };
}

export async function incrementQuotaCounters(
  tenantId: number,
  tokens: number
): Promise<void> {
  const expiry = endOfMonthTimestamp();

  const [qCount, tCount] = await Promise.all([
    redisIncr(monthKey(tenantId, 'queries')),
    (async () => {
      const r = await import('../db/redis');
      const key = monthKey(tenantId, 'tokens');
      const val = await r.getRedis().incrby(key, tokens);
      await redisExpireAt(key, expiry);
      return val;
    })(),
  ]);

  await redisExpireAt(monthKey(tenantId, 'queries'), expiry);

  // Update Prometheus gauges (best-effort, non-blocking)
  void (async () => {
    const { findTenantById } = await import('../models/tenant');
    const t = await findTenantById(tenantId);
    if (t) {
      quotaRemaining.set(
        { tenant_id: String(tenantId), quota_type: 'queries' },
        Math.max(0, t.monthly_query_limit - qCount)
      );
      quotaRemaining.set(
        { tenant_id: String(tenantId), quota_type: 'tokens' },
        Math.max(0, t.monthly_token_limit - tCount)
      );
    }
  })();
}

export async function recordDailySummary(
  tenantId: number,
  tokens: number,
  cost: number
): Promise<void> {
  const key = dailyKey(tenantId);
  await Promise.all([
    redisHIncrBy(key, 'queries', 1),
    redisHIncrBy(key, 'tokens', tokens),
    // Store cost as micro-dollars to avoid float issues
    redisHIncrBy(key, 'cost_microdollars', Math.round(cost * 1_000_000)),
  ]);
  await redisExpire(key, 90 * 86400); // keep 90 days of daily keys
}

export async function logUsage(log: Omit<UsageLog, 'id' | 'created_at'>): Promise<void> {
  // Write to PostgreSQL asynchronously — don't block the response
  setImmediate(async () => {
    try {
      await insertUsageLog({
        ...log,
        cost_usd: roundUsd(log.cost_usd),
        gateway_cost_usd: roundUsd(log.gateway_cost_usd),
        tenant_charge_usd: roundUsd(log.tenant_charge_usd),
      });

      tokensTotal.inc({ tenant_id: String(log.tenant_id), type: 'prompt' }, log.prompt_tokens);
      tokensTotal.inc(
        { tenant_id: String(log.tenant_id), type: 'completion' },
        log.completion_tokens
      );
    } catch (err) {
      const { logger } = await import('../utils/logger');
      logger.error({ err, tenantId: log.tenant_id }, 'Failed to write usage log');
    }
  });
}
