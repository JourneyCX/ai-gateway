export interface Tenant {
  id: number;
  tenant_id: number;
  is_enabled: boolean;
  subscription_tier: string;
  monthly_query_limit: number;
  monthly_token_limit: number;
  markup_multiplier: number;
  created_at: Date;
  updated_at: Date;
}

export interface UsageLog {
  id?: number;
  tenant_id: number;
  request_id: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
  gateway_cost_usd: number;
  tenant_charge_usd: number;
  response_time_ms: number;
  cache_hit: boolean;
  status_code: number;
  error_message?: string | null;
  created_at?: Date;
}

// ── OpenAI-compatible request/response shapes ──────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string[];
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: string;
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface TenantUsageSummary {
  current_month_queries: number;
  current_month_tokens: number;
  monthly_quota_queries: number;
  monthly_quota_tokens: number;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: TokenUsage;
  'x-tenant-usage'?: TenantUsageSummary;
}

// ── Internal service types ──────────────────────────────────

export interface QuotaStatus {
  queries_used: number;
  tokens_used: number;
  queries_limit: number;
  tokens_limit: number;
  queries_exceeded: boolean;
  tokens_exceeded: boolean;
}

export interface CostBreakdown {
  gateway_cost_usd: number;
  tenant_charge_usd: number;
  cache_hit: boolean;
}

export interface GatewayError {
  error: string;
  code?: string;
  retry_after?: number;
}

// ── Fastify request augmentation ───────────────────────────

import type { FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    tenantId?: number;
    tenant?: Tenant;
    requestId?: string;
  }
}
