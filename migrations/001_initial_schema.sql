-- ============================================================
-- Migration 001 — Initial Schema
-- AI Gateway: tenants, usage_logs, response_cache
-- ============================================================

-- ── Tenants ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
    id                   SERIAL PRIMARY KEY,
    tenant_id            BIGINT        NOT NULL UNIQUE,
    is_enabled           BOOLEAN       NOT NULL DEFAULT true,
    subscription_tier    VARCHAR(50)   NOT NULL DEFAULT 'starter',
    monthly_query_limit  INTEGER       NOT NULL DEFAULT 5000,
    monthly_token_limit  INTEGER       NOT NULL DEFAULT 1000000,
    markup_multiplier    DECIMAL(8,4)  NOT NULL DEFAULT 10.0,
    created_at           TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tenants_enabled ON tenants(is_enabled) WHERE is_enabled = true;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER tenants_updated_at
    BEFORE UPDATE ON tenants
    FOR EACH ROW
    EXECUTE PROCEDURE update_updated_at_column();

-- ── Usage Logs ───────────────────────────────────────────────
-- Partitioned by month for efficient archival and querying
CREATE TABLE IF NOT EXISTS usage_logs (
    id                   BIGSERIAL,
    tenant_id            BIGINT         NOT NULL,
    request_id           VARCHAR(64)    NOT NULL,
    model                VARCHAR(100)   NOT NULL,
    prompt_tokens        INTEGER        NOT NULL DEFAULT 0,
    completion_tokens    INTEGER        NOT NULL DEFAULT 0,
    total_tokens         INTEGER        NOT NULL DEFAULT 0,
    cost_usd             DECIMAL(12,6)  NOT NULL DEFAULT 0,
    gateway_cost_usd     DECIMAL(12,6)  NOT NULL DEFAULT 0,
    tenant_charge_usd    DECIMAL(12,6)  NOT NULL DEFAULT 0,
    response_time_ms     INTEGER        NOT NULL DEFAULT 0,
    cache_hit            BOOLEAN        NOT NULL DEFAULT false,
    status_code          SMALLINT       NOT NULL,
    error_message        TEXT,
    created_at           TIMESTAMPTZ    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Create partitions for the current year (extend script for future years)
DO $$
DECLARE
    year INT := EXTRACT(YEAR FROM CURRENT_DATE)::INT;
    month INT;
    start_date DATE;
    end_date DATE;
    partition_name TEXT;
BEGIN
    FOR month IN 1..12 LOOP
        start_date := make_date(year, month, 1);
        end_date   := start_date + INTERVAL '1 month';
        partition_name := 'usage_logs_' || TO_CHAR(start_date, 'YYYY_MM');

        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS %I PARTITION OF usage_logs
             FOR VALUES FROM (%L) TO (%L)',
            partition_name, start_date, end_date
        );
    END LOOP;
END $$;

-- ── Indexes on usage_logs ────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_usage_tenant_date
    ON usage_logs(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_usage_request_id
    ON usage_logs(request_id);

CREATE INDEX IF NOT EXISTS idx_usage_status
    ON usage_logs(status_code, created_at DESC);

-- ── Response Cache (PostgreSQL fallback — primary is Redis) ──
CREATE TABLE IF NOT EXISTS response_cache (
    cache_key     VARCHAR(255)   PRIMARY KEY,
    tenant_id     BIGINT         NOT NULL,
    response_json JSONB          NOT NULL,
    created_at    TIMESTAMPTZ    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at    TIMESTAMPTZ    NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_cache_expiry  ON response_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_cache_tenant  ON response_cache(tenant_id);

-- ── Cleanup job hint (run via pg_cron or external scheduler) ─
-- DELETE FROM response_cache WHERE expires_at < NOW();

-- ── Seed subscription tiers reference data ───────────────────
CREATE TABLE IF NOT EXISTS subscription_tiers (
    tier                VARCHAR(50)  PRIMARY KEY,
    monthly_query_limit INTEGER      NOT NULL,
    monthly_token_limit INTEGER      NOT NULL,
    markup_multiplier   DECIMAL(8,4) NOT NULL,
    description         TEXT
);

INSERT INTO subscription_tiers (tier, monthly_query_limit, monthly_token_limit, markup_multiplier, description)
VALUES
    ('starter',    5000,    1000000,  10.0, 'Entry-level — 5K queries, 1M tokens/month'),
    ('growth',     20000,   5000000,  8.0,  'Growth — 20K queries, 5M tokens/month'),
    ('scale',      100000,  25000000, 6.0,  'Scale — 100K queries, 25M tokens/month'),
    ('enterprise', 500000,  100000000,5.0,  'Enterprise — 500K queries, 100M tokens/month')
ON CONFLICT (tier) DO NOTHING;
