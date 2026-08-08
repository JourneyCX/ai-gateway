import pino from 'pino';
import { config } from '../config';

export const logger = pino({
  level: config.LOG_LEVEL,
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
      : undefined,
  base: { service: 'ai-gateway' },
  redact: {
    paths: ['req.headers["x-api-key"]', 'req.headers.authorization'],
    censor: '[REDACTED]',
  },
});
