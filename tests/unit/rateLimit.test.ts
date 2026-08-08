import { describe, it, expect, beforeEach, jest } from '@jest/globals';

/**
 * Tests the token-bucket rate limit algorithm logic in isolation,
 * without a real Redis connection. We validate the Lua-equivalent
 * behaviour using a pure-JS simulation.
 */

interface BucketState {
  tokens: number;
  lastRefill: number;
}

function tokenBucketCheck(
  state: BucketState,
  capacity: number,
  refillRpm: number,
  nowMs: number,
  cost: number
): { allowed: boolean; retryAfterSeconds: number; newState: BucketState } {
  const elapsedMin = (nowMs - state.lastRefill) / 60_000;
  const refilled = Math.min(capacity, state.tokens + elapsedMin * refillRpm);

  if (refilled < cost) {
    const retryAfterSeconds = Math.ceil(((cost - refilled) / refillRpm) * 60);
    return { allowed: false, retryAfterSeconds, newState: state };
  }

  return {
    allowed: true,
    retryAfterSeconds: 0,
    newState: { tokens: refilled - cost, lastRefill: nowMs },
  };
}

describe('token bucket rate limiter (algorithm)', () => {
  let state: BucketState;
  const capacity = 70; // RPM=60 + burst=10
  const refillRpm = 60;
  const t0 = 1_000_000;

  beforeEach(() => {
    state = { tokens: capacity, lastRefill: t0 };
  });

  it('allows a request when bucket is full', () => {
    const result = tokenBucketCheck(state, capacity, refillRpm, t0, 1);
    expect(result.allowed).toBe(true);
  });

  it('consumes a token on each request', () => {
    const result = tokenBucketCheck(state, capacity, refillRpm, t0, 1);
    expect(result.newState.tokens).toBe(capacity - 1);
  });

  it('blocks when bucket is empty', () => {
    state = { tokens: 0, lastRefill: t0 };
    const result = tokenBucketCheck(state, capacity, refillRpm, t0, 1);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('refills proportionally to elapsed time', () => {
    state = { tokens: 0, lastRefill: t0 };
    // After 30 seconds, we should have 30 tokens refilled (60 rpm = 1/s)
    const result = tokenBucketCheck(state, capacity, refillRpm, t0 + 30_000, 1);
    expect(result.allowed).toBe(true);
    expect(result.newState.tokens).toBeCloseTo(29, 0);
  });

  it('does not exceed capacity when refilling', () => {
    state = { tokens: 0, lastRefill: t0 - 120_000 }; // 2 minutes ago
    const result = tokenBucketCheck(state, capacity, refillRpm, t0, 0);
    expect(result.newState.tokens).toBeLessThanOrEqual(capacity);
  });

  it('blocks 71st request within 1 minute without refill (burst exhausted)', () => {
    let s = { tokens: capacity, lastRefill: t0 };
    for (let i = 0; i < capacity; i++) {
      const r = tokenBucketCheck(s, capacity, refillRpm, t0, 1);
      expect(r.allowed).toBe(true);
      s = r.newState;
    }
    const last = tokenBucketCheck(s, capacity, refillRpm, t0, 1);
    expect(last.allowed).toBe(false);
  });
});
