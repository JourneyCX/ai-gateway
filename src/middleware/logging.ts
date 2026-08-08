import type { FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../utils/logger';
import { generateRequestId } from '../utils/crypto';

export async function requestLogger(
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  request.requestId = (request.headers['x-request-id'] as string) ?? generateRequestId();

  logger.info({
    requestId: request.requestId,
    tenantId: request.tenantId,
    method: request.method,
    url: request.url,
    userAgent: request.headers['user-agent'],
  }, 'Incoming request');
}
