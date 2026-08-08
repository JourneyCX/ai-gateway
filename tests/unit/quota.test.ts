import { describe, it, expect } from '@jest/globals';
import type { Tenant, QuotaStatus } from '../../src/types';

// Pure logic test — extract the quota-exceeded decision from Redis values
function evaluateQuota(tenant: Tenant, queriesUsed: number, tokensUsed: number): QuotaStatus {
  return {
    queries_used: queriesUsed,
    tokens_used: tokensUsed,
    queries_limit: tenant.monthly_query_limit,
    tokens_limit: tenant.monthly_token_limit,
    queries_exceeded: queriesUsed >= tenant.monthly_query_limit,
    tokens_exceeded: tokensUsed >= tenant.monthly_token_limit,
  };
}

const baseTenant: Tenant = {
  id: 1,
  tenant_id: 100,
  is_enabled: true,
  subscription_tier: 'starter',
  monthly_query_limit: 5000,
  monthly_token_limit: 1_000_000,
  markup_multiplier: 10,
  created_at: new Date(),
  updated_at: new Date(),
};

describe('quota enforcer', () => {
  it('allows requests when under quota', () => {
    const status = evaluateQuota(baseTenant, 100, 5000);
    expect(status.queries_exceeded).toBe(false);
    expect(status.tokens_exceeded).toBe(false);
  });

  it('blocks when query count equals limit (boundary)', () => {
    const status = evaluateQuota(baseTenant, 5000, 0);
    expect(status.queries_exceeded).toBe(true);
  });

  it('blocks when query count exceeds limit', () => {
    const status = evaluateQuota(baseTenant, 5001, 0);
    expect(status.queries_exceeded).toBe(true);
  });

  it('blocks when token count equals limit (boundary)', () => {
    const status = evaluateQuota(baseTenant, 0, 1_000_000);
    expect(status.tokens_exceeded).toBe(true);
  });

  it('blocks when token count exceeds limit', () => {
    const status = evaluateQuota(baseTenant, 0, 1_000_001);
    expect(status.tokens_exceeded).toBe(true);
  });

  it('allows at one below the limit', () => {
    const status = evaluateQuota(baseTenant, 4999, 999_999);
    expect(status.queries_exceeded).toBe(false);
    expect(status.tokens_exceeded).toBe(false);
  });

  it('returns correct remaining counts', () => {
    const status = evaluateQuota(baseTenant, 1000, 200_000);
    expect(status.queries_limit - status.queries_used).toBe(4000);
    expect(status.tokens_limit - status.tokens_used).toBe(800_000);
  });
});
