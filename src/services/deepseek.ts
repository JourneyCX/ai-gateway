import axios, { type AxiosInstance, AxiosError } from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';
import { deepseekDuration } from '../utils/metrics';
import type { ChatCompletionRequest, ChatCompletionResponse } from '../types';

const RETRYABLE_CODES = new Set([429, 500, 502, 503, 504]);

function buildClient(): AxiosInstance {
  return axios.create({
    baseURL: config.DEEPSEEK_BASE_URL,
    timeout: config.DEEPSEEK_TIMEOUT_MS,
    headers: {
      Authorization: `Bearer ${config.DEEPSEEK_API_KEY}`,
      'Content-Type': 'application/json',
    },
  });
}

const client = buildClient();

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function chatCompletion(
  request: ChatCompletionRequest,
  tenantId: number
): Promise<ChatCompletionResponse> {
  const payload = {
    ...request,
    stream: false,
    user: String(tenantId), // enables KVCache discount on DeepSeek
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < config.DEEPSEEK_MAX_RETRIES; attempt++) {
    const endTimer = deepseekDuration.startTimer();
    try {
      const response = await client.post<ChatCompletionResponse>(
        '/chat/completions',
        payload
      );
      endTimer();
      return response.data;
    } catch (err) {
      endTimer();
      const axiosErr = err as AxiosError;
      const status = axiosErr.response?.status;

      if (status && RETRYABLE_CODES.has(status) && attempt < config.DEEPSEEK_MAX_RETRIES - 1) {
        const backoffMs = Math.pow(2, attempt) * 1000;
        logger.warn(
          { attempt, status, backoffMs },
          'DeepSeek API error, retrying'
        );
        await sleep(backoffMs);
        lastError = err as Error;
        continue;
      }

      if (axiosErr.code === 'ECONNABORTED' || axiosErr.code === 'ETIMEDOUT') {
        throw new GatewayTimeoutError('DeepSeek request timed out');
      }

      throw new DeepSeekError(
        `DeepSeek API error: ${status ?? 'unknown'}`,
        status ?? 500
      );
    }
  }

  throw lastError ?? new DeepSeekError('DeepSeek API request failed after retries', 500);
}

export class DeepSeekError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = 'DeepSeekError';
  }
}

export class GatewayTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GatewayTimeoutError';
  }
}
