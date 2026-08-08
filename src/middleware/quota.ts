import type { FastifyRequest, FastifyReply } from 'fastify';
import { getQuotaStatus } from '../services/usage';
import type { Tenant } from '../types';

export async function enforceQuota(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const tenant = request.tenant as Tenant;

  const status = await getQuotaStatus(tenant);

  if (status.queries_exceeded) {
    await reply.code(402).send({
      error: 'Monthly query quota exceeded. Please upgrade your plan or contact support.',
      quota: {
        used: status.queries_used,
        limit: status.queries_limit,
        type: 'queries',
      },
    });
    return;
  }

  if (status.tokens_exceeded) {
    await reply.code(402).send({
      error: 'Monthly token quota exceeded. Please upgrade your plan or contact support.',
      quota: {
        used: status.tokens_used,
        limit: status.tokens_limit,
        type: 'tokens',
      },
    });
  }
}
