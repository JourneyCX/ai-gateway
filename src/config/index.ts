import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv();

const schema = z.object({
  // Server
  PORT: z.coerce.number().default(8080),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),

  // Auth
  GATEWAY_API_KEY: z.string().min(16),
  ADMIN_API_KEY: z.string().min(16),

  // DeepSeek
  DEEPSEEK_API_KEY: z.string().min(1),
  DEEPSEEK_BASE_URL: z.string().url().default('https://api.deepseek.com'),
  DEEPSEEK_TIMEOUT_MS: z.coerce.number().default(30000),
  DEEPSEEK_MAX_RETRIES: z.coerce.number().default(3),

  // Database
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  // Quota defaults
  DEFAULT_MONTHLY_QUERY_LIMIT: z.coerce.number().default(5000),
  DEFAULT_MONTHLY_TOKEN_LIMIT: z.coerce.number().default(1_000_000),
  DEFAULT_MARKUP_MULTIPLIER: z.coerce.number().default(10.0),

  // Rate limiting
  RATE_LIMIT_RPM: z.coerce.number().default(60),
  RATE_LIMIT_BURST: z.coerce.number().default(10),

  // Cache
  ENABLE_CACHE: z.string().transform((v) => v === 'true').default('true'),
  CACHE_TTL_SECONDS: z.coerce.number().default(86400),

  // Metrics
  ENABLE_METRICS: z.string().transform((v) => v === 'true').default('true'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
