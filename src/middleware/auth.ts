import type { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config';

export async function authenticateRequest(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const apiKey = request.headers['x-api-key'];
  if (!apiKey || apiKey !== config.GATEWAY_API_KEY) {
    await reply.code(401).send({ error: 'Invalid or missing API key' });
  }
}

export async function authenticateAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const apiKey = request.headers['x-api-key'];
  if (!apiKey || apiKey !== config.ADMIN_API_KEY) {
    await reply.code(401).send({ error: 'Admin access required' });
  }
}
