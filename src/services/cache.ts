import { redisGet, redisSet } from '../db/redis';
import { buildCacheKey } from '../utils/crypto';
import { config } from '../config';
import type { ChatCompletionResponse, ChatMessage } from '../types';

export async function getCachedResponse(
  tenantId: number,
  messages: ChatMessage[],
  model: string
): Promise<ChatCompletionResponse | null> {
  if (!config.ENABLE_CACHE) return null;

  const key = buildCacheKey(tenantId, messages, model);
  const cached = await redisGet(key);
  if (!cached) return null;

  try {
    return JSON.parse(cached) as ChatCompletionResponse;
  } catch {
    return null;
  }
}

export async function setCachedResponse(
  tenantId: number,
  messages: ChatMessage[],
  model: string,
  response: ChatCompletionResponse
): Promise<void> {
  if (!config.ENABLE_CACHE) return;

  const key = buildCacheKey(tenantId, messages, model);
  await redisSet(key, JSON.stringify(response), config.CACHE_TTL_SECONDS);
}
