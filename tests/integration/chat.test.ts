/**
 * Integration tests for POST /v1/chat/completions
 *
 * These tests use a real Fastify instance with mocked external dependencies
 * (DeepSeek API, PostgreSQL, Redis) so they run without live services.
 *
 * Set environment variables before running:
 *   DEEPSEEK_API_KEY=test GATEWAY_API_KEY=test-key ADMIN_API_KEY=test-admin
 *   DATABASE_URL=postgresql://... REDIS_URL=redis://...
 *
 * Or use docker-compose -f docker/docker-compose.yml up -d postgres redis
 * before running the integration suite.
 */

import { describe, it, expect, beforeAll, afterAll, jest, beforeEach } from '@jest/globals';

// ── Mock external dependencies ─────────────────────────────
jest.mock('../../src/services/deepseek', () => ({
  chatCompletion: jest.fn(),
  DeepSeekError: class DeepSeekError extends Error {
    statusCode: number;
    constructor(msg: string, code: number) { super(msg); this.statusCode = code; }
  },
  GatewayTimeoutError: class GatewayTimeoutError extends Error {},
}));

jest.mock('../../src/db/postgres', () => ({
  getPool: jest.fn(),
  query: jest.fn(),
  queryOne: jest.fn(),
  withTransaction: jest.fn(),
  closePool: jest.fn(),
}));

jest.mock('../../src/db/redis', () => ({
  getRedis: jest.fn(() => ({
    ping: jest.fn().mockResolvedValue('PONG'),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn(),
    incr: jest.fn().mockResolvedValue(1),
    incrby: jest.fn().mockResolvedValue(100),
    hincrby: jest.fn().mockResolvedValue(1),
    hset: jest.fn(),
    expire: jest.fn(),
    expireat: jest.fn(),
    eval: jest.fn().mockResolvedValue([1, 0, 59]), // allowed, no retry, 59 tokens left
    quit: jest.fn(),
  })),
  redisGet: jest.fn().mockResolvedValue(null),
  redisSet: jest.fn(),
  redisIncr: jest.fn().mockResolvedValue(1),
  redisExpireAt: jest.fn(),
  redisHIncrBy: jest.fn().mockResolvedValue(1),
  redisHSet: jest.fn(),
  redisExpire: jest.fn(),
  redisDel: jest.fn(),
  closeRedis: jest.fn(),
}));

import { buildServer } from '../../src/server';
import { chatCompletion } from '../../src/services/deepseek';
import { queryOne } from '../../src/db/postgres';
import type { FastifyInstance } from 'fastify';

const TENANT_ID = '12345';
const API_KEY = 'test-key-1234567890123456';
const ADMIN_KEY = 'admin-key-1234567890123456';

const mockTenant = {
  id: 1,
  tenant_id: 12345,
  is_enabled: true,
  subscription_tier: 'starter',
  monthly_query_limit: 5000,
  monthly_token_limit: 1_000_000,
  markup_multiplier: 10.0,
  created_at: new Date(),
  updated_at: new Date(),
};

const mockDeepSeekResponse = {
  id: 'chatcmpl-test',
  object: 'chat.completion',
  created: Math.floor(Date.now() / 1000),
  model: 'deepseek-chat',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'Hello! How can I help?' },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
};

describe('POST /v1/chat/completions', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    process.env.GATEWAY_API_KEY = API_KEY;
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    process.env.DATABASE_URL = 'postgresql://x:x@localhost/x';
    process.env.REDIS_URL = 'redis://localhost:6379';

    server = await buildServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (queryOne as jest.Mock).mockResolvedValue(mockTenant);
    (chatCompletion as jest.Mock).mockResolvedValue(mockDeepSeekResponse);
  });

  it('returns 401 when API key is missing', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { 'x-tenant-id': TENANT_ID },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }] }),
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when X-Tenant-ID is missing', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { 'x-api-key': API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }] }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for invalid request body (empty messages)', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        'x-api-key': API_KEY,
        'x-tenant-id': TENANT_ID,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ messages: [] }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 200 with valid request', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        'x-api-key': API_KEY,
        'x-tenant-id': TENANT_ID,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('choices');
    expect(body).toHaveProperty('usage');
    expect(body).toHaveProperty('x-tenant-usage');
  });

  it('returns 402 when query quota exceeded', async () => {
    // Tenant at limit
    (queryOne as jest.Mock).mockResolvedValue({
      ...mockTenant,
      monthly_query_limit: 5000,
    });
    // Redis returns count equal to limit
    const { redisGet } = await import('../../src/db/redis');
    (redisGet as jest.Mock).mockImplementation((key: string) => {
      if (key.includes(':queries:')) return Promise.resolve('5000');
      return Promise.resolve(null);
    });

    const res = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        'x-api-key': API_KEY,
        'x-tenant-id': TENANT_ID,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    });
    expect(res.statusCode).toBe(402);
    const body = res.json();
    expect(body.error).toMatch(/quota exceeded/i);
  });

  it('returns 403 when tenant is disabled', async () => {
    (queryOne as jest.Mock).mockResolvedValue({ ...mockTenant, is_enabled: false });

    const res = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        'x-api-key': API_KEY,
        'x-tenant-id': TENANT_ID,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }] }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 200 from cache on repeated identical request', async () => {
    const { redisGet } = await import('../../src/db/redis');
    (redisGet as jest.Mock).mockImplementation((key: string) => {
      if (key.startsWith('cache:')) {
        return Promise.resolve(JSON.stringify(mockDeepSeekResponse));
      }
      return Promise.resolve(null);
    });

    const res = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        'x-api-key': API_KEY,
        'x-tenant-id': TENANT_ID,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }),
    });
    expect(res.statusCode).toBe(200);
    // DeepSeek should NOT have been called
    expect(chatCompletion).not.toHaveBeenCalled();
  });
});

describe('GET /v1/health', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await buildServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it('returns 200 or 503 with status field', async () => {
    const res = await server.inject({ method: 'GET', url: '/v1/health' });
    expect([200, 503]).toContain(res.statusCode);
    const body = res.json();
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('checks');
  });
});
