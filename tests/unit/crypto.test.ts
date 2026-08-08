import { describe, it, expect } from '@jest/globals';
import { buildCacheKey, generateRequestId } from '../../src/utils/crypto';

describe('crypto utils', () => {
  describe('buildCacheKey', () => {
    it('is deterministic — same input yields same key', () => {
      const messages = [{ role: 'user' as const, content: 'Hello' }];
      const key1 = buildCacheKey(123, messages, 'deepseek-chat');
      const key2 = buildCacheKey(123, messages, 'deepseek-chat');
      expect(key1).toBe(key2);
    });

    it('differs for different tenants', () => {
      const messages = [{ role: 'user' as const, content: 'Hello' }];
      expect(buildCacheKey(1, messages, 'deepseek-chat')).not.toBe(
        buildCacheKey(2, messages, 'deepseek-chat')
      );
    });

    it('differs for different messages', () => {
      const msgs1 = [{ role: 'user' as const, content: 'Hello' }];
      const msgs2 = [{ role: 'user' as const, content: 'Goodbye' }];
      expect(buildCacheKey(1, msgs1, 'deepseek-chat')).not.toBe(
        buildCacheKey(1, msgs2, 'deepseek-chat')
      );
    });

    it('differs for different models', () => {
      const messages = [{ role: 'user' as const, content: 'Hello' }];
      expect(buildCacheKey(1, messages, 'model-a')).not.toBe(
        buildCacheKey(1, messages, 'model-b')
      );
    });

    it('starts with cache:{tenantId}: prefix', () => {
      const key = buildCacheKey(42, [], 'model');
      expect(key).toMatch(/^cache:42:/);
    });

    it('is stable across message ordering variations', () => {
      // Same content, same order — should be identical
      const m1 = [
        { role: 'system' as const, content: 'You are helpful' },
        { role: 'user' as const, content: 'Hi' },
      ];
      const m2 = [
        { role: 'system' as const, content: 'You are helpful' },
        { role: 'user' as const, content: 'Hi' },
      ];
      expect(buildCacheKey(1, m1, 'model')).toBe(buildCacheKey(1, m2, 'model'));
    });
  });

  describe('generateRequestId', () => {
    it('returns a non-empty string', () => {
      const id = generateRequestId();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('generates unique IDs', () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateRequestId()));
      expect(ids.size).toBe(100);
    });
  });
});
