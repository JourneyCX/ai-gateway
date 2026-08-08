import { query, queryOne } from '../db/postgres';
import { config } from '../config';
import type { Tenant } from '../types';

export async function findTenantById(tenantId: number): Promise<Tenant | null> {
  return queryOne<Tenant>(
    'SELECT * FROM tenants WHERE tenant_id = $1',
    [tenantId]
  );
}

export async function createTenant(tenantId: number, tier = 'starter'): Promise<Tenant> {
  const [tenant] = await query<Tenant>(
    `INSERT INTO tenants (tenant_id, subscription_tier, monthly_query_limit, monthly_token_limit, markup_multiplier)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tenant_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [
      tenantId,
      tier,
      config.DEFAULT_MONTHLY_QUERY_LIMIT,
      config.DEFAULT_MONTHLY_TOKEN_LIMIT,
      config.DEFAULT_MARKUP_MULTIPLIER,
    ]
  );
  return tenant;
}

export async function updateTenantQuota(
  tenantId: number,
  monthly_query_limit: number,
  monthly_token_limit: number
): Promise<Tenant | null> {
  return queryOne<Tenant>(
    `UPDATE tenants
     SET monthly_query_limit = $1, monthly_token_limit = $2, updated_at = CURRENT_TIMESTAMP
     WHERE tenant_id = $3
     RETURNING *`,
    [monthly_query_limit, monthly_token_limit, tenantId]
  );
}

export async function updateTenantMarkup(
  tenantId: number,
  markup_multiplier: number
): Promise<Tenant | null> {
  return queryOne<Tenant>(
    `UPDATE tenants
     SET markup_multiplier = $1, updated_at = CURRENT_TIMESTAMP
     WHERE tenant_id = $2
     RETURNING *`,
    [markup_multiplier, tenantId]
  );
}

export async function setTenantEnabled(
  tenantId: number,
  is_enabled: boolean
): Promise<Tenant | null> {
  return queryOne<Tenant>(
    `UPDATE tenants SET is_enabled = $1, updated_at = CURRENT_TIMESTAMP
     WHERE tenant_id = $2 RETURNING *`,
    [is_enabled, tenantId]
  );
}

export async function countActiveTenants(): Promise<number> {
  const row = await queryOne<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM tenants WHERE is_enabled = true'
  );
  return row ? parseInt(row.count, 10) : 0;
}

export async function getMonthlyUsageSummary(
  tenantId: number,
  yearMonth: string
): Promise<{ total_queries: number; total_tokens: number; total_cost_usd: number }> {
  const row = await queryOne<{
    total_queries: string;
    total_tokens: string;
    total_cost_usd: string;
  }>(
    `SELECT
       COUNT(*)::text         AS total_queries,
       COALESCE(SUM(total_tokens), 0)::text  AS total_tokens,
       COALESCE(SUM(tenant_charge_usd), 0)::text AS total_cost_usd
     FROM usage_logs
     WHERE tenant_id = $1
       AND TO_CHAR(created_at, 'YYYY-MM') = $2
       AND status_code = 200`,
    [tenantId, yearMonth]
  );
  return {
    total_queries: row ? parseInt(row.total_queries, 10) : 0,
    total_tokens: row ? parseInt(row.total_tokens, 10) : 0,
    total_cost_usd: row ? parseFloat(row.total_cost_usd) : 0,
  };
}
