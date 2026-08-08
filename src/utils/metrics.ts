import client from 'prom-client';
import { config } from '../config';

// Use the default registry
const register = client.register;

if (config.ENABLE_METRICS) {
  client.collectDefaultMetrics({ register });
}

// ── Counters ────────────────────────────────────────────────

export const requestsTotal = new client.Counter({
  name: 'ai_gateway_requests_total',
  help: 'Total number of gateway requests',
  labelNames: ['tenant_id', 'model', 'status'],
  registers: [register],
});

export const tokensTotal = new client.Counter({
  name: 'ai_gateway_tokens_total',
  help: 'Total tokens processed',
  labelNames: ['tenant_id', 'type'],
  registers: [register],
});

export const errorsTotal = new client.Counter({
  name: 'ai_gateway_errors_total',
  help: 'Total gateway errors',
  labelNames: ['tenant_id', 'error_type'],
  registers: [register],
});

// ── Histograms ──────────────────────────────────────────────

export const requestDuration = new client.Histogram({
  name: 'ai_gateway_request_duration_seconds',
  help: 'End-to-end request duration in seconds',
  labelNames: ['tenant_id', 'model'],
  buckets: [0.1, 0.5, 1, 2, 3, 5, 10],
  registers: [register],
});

export const deepseekDuration = new client.Histogram({
  name: 'ai_gateway_deepseek_duration_seconds',
  help: 'DeepSeek API call duration in seconds',
  buckets: [0.1, 0.5, 1, 2, 3, 5, 10, 30],
  registers: [register],
});

// ── Gauges ──────────────────────────────────────────────────

export const quotaRemaining = new client.Gauge({
  name: 'ai_gateway_quota_remaining',
  help: 'Remaining monthly quota',
  labelNames: ['tenant_id', 'quota_type'],
  registers: [register],
});

export const activeTenants = new client.Gauge({
  name: 'ai_gateway_active_tenants',
  help: 'Number of enabled tenants',
  registers: [register],
});

export { register };
