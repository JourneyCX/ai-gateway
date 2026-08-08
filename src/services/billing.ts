import type { CostBreakdown, TokenUsage } from '../types';

// DeepSeek v4 pricing per 1M tokens (USD) — verify at https://console.deepseek.com
const DEEPSEEK_INPUT_COST_PER_1M = 0.56;
const DEEPSEEK_OUTPUT_COST_PER_1M = 1.68;
const DEEPSEEK_CACHE_HIT_INPUT_COST_PER_1M = 0.07;  // ~87.5% discount via KVCache

export function calculateGatewayCost(usage: TokenUsage, cacheHit = false): number {
  const inputCostPer1M = cacheHit
    ? DEEPSEEK_CACHE_HIT_INPUT_COST_PER_1M
    : DEEPSEEK_INPUT_COST_PER_1M;

  const inputCost = (usage.prompt_tokens / 1_000_000) * inputCostPer1M;
  const outputCost = (usage.completion_tokens / 1_000_000) * DEEPSEEK_OUTPUT_COST_PER_1M;
  return inputCost + outputCost;
}

export function calculateTenantCharge(gatewayCost: number, markupMultiplier: number): number {
  return gatewayCost * markupMultiplier;
}

export function buildCostBreakdown(
  usage: TokenUsage,
  markupMultiplier: number,
  cacheHit = false
): CostBreakdown {
  const gatewayCost = calculateGatewayCost(usage, cacheHit);
  const tenantCharge = calculateTenantCharge(gatewayCost, markupMultiplier);
  return {
    gateway_cost_usd: gatewayCost,
    tenant_charge_usd: tenantCharge,
    cache_hit: cacheHit,
  };
}

/** Round to 6 decimal places for USD storage */
export function roundUsd(amount: number): number {
  return Math.round(amount * 1_000_000) / 1_000_000;
}
