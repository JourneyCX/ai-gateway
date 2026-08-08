import { createHash } from 'crypto';
import type { ChatMessage } from '../types';

/**
 * Deterministic cache key from tenant + message array.
 * Stable across restarts — same input always yields same hash.
 */
export function buildCacheKey(tenantId: number, messages: ChatMessage[], model: string): string {
  const payload = JSON.stringify({ tenantId, model, messages });
  const hash = createHash('sha256').update(payload).digest('hex').slice(0, 32);
  return `cache:${tenantId}:${hash}`;
}

export function generateRequestId(): string {
  return createHash('sha256')
    .update(`${Date.now()}-${Math.random()}`)
    .digest('hex')
    .slice(0, 16);
}
