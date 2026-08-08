import { describe, it, expect } from '@jest/globals';
import {
  calculateGatewayCost,
  calculateTenantCharge,
  buildCostBreakdown,
  roundUsd,
} from '../../src/services/billing';

describe('billing service', () => {
  describe('calculateGatewayCost', () => {
    it('calculates cost correctly for cache miss', () => {
      // 1M prompt tokens + 1M completion tokens, cache miss
      const cost = calculateGatewayCost(
        { prompt_tokens: 1_000_000, completion_tokens: 1_000_000, total_tokens: 2_000_000 },
        false
      );
      // input: $0.56, output: $1.68
      expect(cost).toBeCloseTo(2.24, 4);
    });

    it('uses discounted rate for cache hit', () => {
      const costMiss = calculateGatewayCost(
        { prompt_tokens: 1_000_000, completion_tokens: 0, total_tokens: 1_000_000 },
        false
      );
      const costHit = calculateGatewayCost(
        { prompt_tokens: 1_000_000, completion_tokens: 0, total_tokens: 1_000_000 },
        true
      );
      expect(costHit).toBeLessThan(costMiss);
      // cache-hit input cost = $0.07 per 1M
      expect(costHit).toBeCloseTo(0.07, 4);
    });

    it('returns 0 for zero tokens', () => {
      const cost = calculateGatewayCost({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
      expect(cost).toBe(0);
    });

    it('is proportional for small token counts', () => {
      const cost = calculateGatewayCost(
        { prompt_tokens: 150, completion_tokens: 80, total_tokens: 230 },
        false
      );
      const expected = (150 / 1_000_000) * 0.56 + (80 / 1_000_000) * 1.68;
      expect(cost).toBeCloseTo(expected, 8);
    });
  });

  describe('calculateTenantCharge', () => {
    it('applies markup multiplier correctly', () => {
      const charge = calculateTenantCharge(0.001, 10);
      expect(charge).toBeCloseTo(0.01, 6);
    });

    it('handles fractional multipliers', () => {
      const charge = calculateTenantCharge(1.0, 5.5);
      expect(charge).toBe(5.5);
    });
  });

  describe('buildCostBreakdown', () => {
    it('returns all three fields', () => {
      const breakdown = buildCostBreakdown(
        { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
        10.0,
        false
      );
      expect(breakdown).toHaveProperty('gateway_cost_usd');
      expect(breakdown).toHaveProperty('tenant_charge_usd');
      expect(breakdown).toHaveProperty('cache_hit', false);
    });

    it('tenant_charge = gateway_cost * markup', () => {
      const breakdown = buildCostBreakdown(
        { prompt_tokens: 1_000_000, completion_tokens: 0, total_tokens: 1_000_000 },
        10.0,
        false
      );
      expect(breakdown.tenant_charge_usd).toBeCloseTo(breakdown.gateway_cost_usd * 10, 4);
    });
  });

  describe('roundUsd', () => {
    it('rounds to 6 decimal places', () => {
      expect(roundUsd(0.000001234567)).toBe(0.000001);
    });

    it('does not lose precision for normal amounts', () => {
      expect(roundUsd(1.234567)).toBe(1.234567);
    });
  });
});
