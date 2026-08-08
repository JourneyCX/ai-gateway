import type { FastifyRequest, FastifyReply } from 'fastify';
import { findTenantById, createTenant } from '../models/tenant';
import { logger } from '../utils/logger';

export async function resolveTenant(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const header = request.headers['x-tenant-id'];
  const tenantId = Array.isArray(header) ? header[0] : header;

  if (!tenantId || isNaN(Number(tenantId))) {
    await reply.code(400).send({ error: 'Missing or invalid X-Tenant-ID header' });
    return;
  }

  const id = parseInt(tenantId, 10);
  let tenant = await findTenantById(id);

  if (!tenant) {
    // Auto-provision new tenant on first request
    logger.info({ tenantId: id }, 'Auto-provisioning new tenant');
    tenant = await createTenant(id);
  }

  if (!tenant.is_enabled) {
    await reply.code(403).send({ error: 'Tenant account is disabled' });
    return;
  }

  request.tenantId = id;
  request.tenant = tenant;
}
