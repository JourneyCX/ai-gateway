# AI Gateway

A standalone multi-tenant AI gateway that sits between your PHP CRM and DeepSeek's API. Handles authentication, rate limiting, quota enforcement, response caching, usage metering, and billing attribution per tenant.

## Architecture

```
CRM (PHP)
  │  POST /v1/chat/completions
  │  X-Tenant-ID: 12345
  │  X-API-Key: <gateway_key>
  ▼
AI Gateway (Node.js/TypeScript + Fastify)
  ├── Auth middleware
  ├── Tenant resolution (PostgreSQL)
  ├── Rate limiter (Redis token bucket)
  ├── Quota enforcer (Redis counters)
  ├── Response cache (Redis)
  └── DeepSeek API client
         │
         ▼
    DeepSeek API
```

Responses include `x-tenant-usage` showing current month consumption.

---

## Quick Start

### Prerequisites

- Node.js 20+
- Docker and Docker Compose
- A DeepSeek API key (https://console.deepseek.com)

### 1. Clone and configure

```bash
git clone <repo> ai-gateway
cd ai-gateway
cp .env.example .env
```

Edit `.env`:

```bash
DEEPSEEK_API_KEY=sk-your-key
GATEWAY_API_KEY=$(openssl rand -hex 32)   # CRM uses this
ADMIN_API_KEY=$(openssl rand -hex 32)     # Admin operations
```

### 2. Start with Docker Compose

```bash
cd docker
docker compose up -d
```

This starts:
- Gateway on port `8080`
- PostgreSQL on `5432` (migrations run automatically from `migrations/`)
- Redis on `6379` with AOF + RDB persistence

### 3. Verify

```bash
curl http://localhost:8080/v1/health
```

Expected: `{"status":"ok","checks":{"postgres":"ok","redis":"ok"},...}`

---

## Development

```bash
npm install
cp .env.example .env  # fill in values

# Start Postgres + Redis (keep gateway local for hot reload)
docker compose -f docker/docker-compose.yml up -d postgres redis

npm run dev           # ts-node-dev with hot reload
```

### Run tests

```bash
npm test              # all tests
npm run test:unit     # unit tests only (no external deps)
npm run test:coverage # with coverage report
```

---

## API Reference

Full OpenAPI spec: [`openapi.yaml`](openapi.yaml)

### Chat completions

```
POST /v1/chat/completions
Headers:
  X-API-Key:    <GATEWAY_API_KEY>
  X-Tenant-ID:  <tenant numeric ID>
  Content-Type: application/json
```

Body (identical to OpenAI format):

```json
{
  "model": "deepseek-chat",
  "messages": [
    {"role": "system", "content": "You are a sales assistant."},
    {"role": "user",   "content": "Top products this month?"}
  ],
  "temperature": 0.7,
  "max_tokens": 2000
}
```

Response includes standard OpenAI fields plus:

```json
"x-tenant-usage": {
  "current_month_queries": 1245,
  "current_month_tokens":  28500,
  "monthly_quota_queries": 5000,
  "monthly_quota_tokens":  1000000
}
```

### Tenant endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET`  | `/v1/tenant/:id/usage` | Gateway key | Monthly usage + daily breakdown |
| `GET`  | `/v1/tenant/:id/quota` | Gateway key | Current quota status |
| `PUT`  | `/v1/tenant/:id/quota` | Admin key | Update query/token limits |
| `PUT`  | `/v1/tenant/:id/markup` | Admin key | Update billing markup |
| `PUT`  | `/v1/tenant/:id/status` | Admin key | Enable/disable tenant |

### Operations

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/v1/health` | Dependency health check |
| `GET`  | `/v1/metrics` | Prometheus metrics |

---

## PHP CRM Integration

Add the gateway client to your CRM (Guzzle-based, production-ready):

```php
<?php
// modules/ai_assistant/libraries/GatewayClient.php

class GatewayClient
{
    private GuzzleHttp\Client $http;
    private string $apiKey;

    public function __construct()
    {
        $this->http = new GuzzleHttp\Client([
            'base_uri' => get_option('ai_gateway_url'),   // e.g. http://gateway:8080
            'timeout'  => 60,
        ]);
        $this->apiKey = get_option('ai_gateway_api_key');
    }

    public function chat(int $tenantId, array $messages, array $options = []): array
    {
        $response = $this->http->post('/v1/chat/completions', [
            'headers' => [
                'X-API-Key'   => $this->apiKey,
                'X-Tenant-ID' => (string) $tenantId,
            ],
            'json' => array_merge([
                'model'    => 'deepseek-chat',
                'messages' => $messages,
                'stream'   => false,
            ], $options),
        ]);

        return json_decode((string) $response->getBody(), true);
    }

    public function getUsage(int $tenantId): array
    {
        $response = $this->http->get("/v1/tenant/{$tenantId}/usage", [
            'headers' => ['X-API-Key' => $this->apiKey],
        ]);
        return json_decode((string) $response->getBody(), true);
    }
}
```

Store `ai_gateway_url` and `ai_gateway_api_key` via `update_option()` in the CRM settings.

---

## Billing model

| Cost component | Formula |
|---|---|
| Gateway cost (input, cache miss) | `(prompt_tokens / 1M) × $0.56` |
| Gateway cost (input, cache hit)  | `(prompt_tokens / 1M) × $0.07` |
| Gateway cost (output) | `(completion_tokens / 1M) × $1.68` |
| Tenant charge | `gateway_cost × markup_multiplier` |

Default markup: **10×** — configurable per tenant via admin API.

All costs stored in `usage_logs.gateway_cost_usd` and `usage_logs.tenant_charge_usd`.

---

## Subscription tiers

| Tier | Queries/month | Tokens/month | Default markup |
|------|--------------|--------------|----------------|
| starter | 5,000 | 1M | 10× |
| growth | 20,000 | 5M | 8× |
| scale | 100,000 | 25M | 6× |
| enterprise | 500,000 | 100M | 5× |

Update a tenant via admin API:

```bash
curl -X PUT http://localhost:8080/v1/tenant/12345/quota \
  -H "X-API-Key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"monthly_query_limit": 20000, "monthly_token_limit": 5000000}'
```

---

## Configuration

All configuration via environment variables (see [`.env.example`](.env.example)).

| Variable | Default | Description |
|----------|---------|-------------|
| `DEEPSEEK_API_KEY` | required | DeepSeek API key |
| `GATEWAY_API_KEY` | required | Key for CRM → Gateway auth |
| `ADMIN_API_KEY` | required | Key for admin endpoints |
| `DATABASE_URL` | required | PostgreSQL connection string |
| `REDIS_URL` | required | Redis connection string |
| `PORT` | `8080` | Server port |
| `LOG_LEVEL` | `info` | trace/debug/info/warn/error |
| `RATE_LIMIT_RPM` | `60` | Requests per minute per tenant |
| `RATE_LIMIT_BURST` | `10` | Burst tokens above RPM |
| `DEFAULT_MARKUP_MULTIPLIER` | `10.0` | Billing markup |
| `ENABLE_CACHE` | `true` | Response caching |
| `CACHE_TTL_SECONDS` | `86400` | Cache TTL (24h) |

---

## Monitoring

### Prometheus

Metrics exposed at `/v1/metrics` in Prometheus text format.

Key metrics:

```
ai_gateway_requests_total{tenant_id,model,status}
ai_gateway_tokens_total{tenant_id,type}         # type: prompt|completion
ai_gateway_errors_total{tenant_id,error_type}
ai_gateway_request_duration_seconds{tenant_id,model}
ai_gateway_deepseek_duration_seconds
ai_gateway_quota_remaining{tenant_id,quota_type}
ai_gateway_active_tenants
```

Alerting rules: [`prometheus/alerts.yaml`](prometheus/alerts.yaml)

### Grafana dashboard (recommended panels)

- Request rate by tenant (last 5 min)
- P95 latency vs. DeepSeek latency
- Quota utilisation per tenant (gauge %)
- Error rate by type
- Cache hit ratio

---

## Database

### Migrations

Migrations run automatically via Docker (`/docker-entrypoint-initdb.d`). To run manually:

```bash
psql $DATABASE_URL -f migrations/001_initial_schema.sql
```

### Partitioned usage_logs

`usage_logs` is range-partitioned by `created_at` (monthly). Partitions for the current year are created by migration 001. Run migration 002 every December to add next-year partitions.

### Backup

```bash
# Dump
pg_dump $DATABASE_URL --no-owner -Fc -f backup-$(date +%Y%m%d).dump

# Restore
pg_restore -d $DATABASE_URL --no-owner backup-YYYYMMDD.dump
```

---

## Production checklist

- [ ] `GATEWAY_API_KEY` and `ADMIN_API_KEY` are cryptographically random (≥ 32 bytes)
- [ ] PostgreSQL `DB_PASSWORD` is a strong secret, not the default
- [ ] Redis persistence is enabled (`appendonly yes` + RDB saves) — default in docker-compose
- [ ] TLS termination at load balancer / reverse proxy
- [ ] Log aggregation configured (forward stdout/stderr to Datadog/Loki/etc.)
- [ ] Prometheus scraping `/v1/metrics` with alert rules applied
- [ ] `DEFAULT_MARKUP_MULTIPLIER` reviewed against your pricing model
- [ ] Annual partition migration (002) scheduled for December via pg_cron or CI job
- [ ] DeepSeek API key rotation procedure documented
- [ ] Health check endpoint wired to load balancer (`/v1/health`)

---

## Security

- No tenant data is ever returned in another tenant's response — tenant ID is enforced at every layer
- API keys are never logged (redacted in pino config)
- Gateway runs as non-root user in Docker
- Helmet sets secure HTTP headers
- All input validated with Zod schemas before processing
- Rate limiting is per-tenant to prevent a single noisy tenant from affecting others

---

## Troubleshooting

**Gateway returns 503 on every request**
→ Check `GET /v1/health` — if Redis or PostgreSQL show `error`, fix that service first.

**Quota not resetting at month boundary**
→ Redis keys have `expireat` set to the first second of the next month. If Redis was down at rollover, keys may persist. Delete manually: `DEL quota:<tenantId>:queries:<YYYY-MM>`.

**DeepSeek calls failing with 429**
→ Gateway auto-retries with exponential backoff (1s, 2s, 4s). If sustained, your DeepSeek account may need a rate limit increase.

**Tenant auto-provisioned with wrong defaults**
→ Tenants are created on first request using `DEFAULT_*` env vars. Update via admin API after creation.
