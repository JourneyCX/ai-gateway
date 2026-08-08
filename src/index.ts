import { buildServer } from './server';
import { config } from './config';
import { logger } from './utils/logger';
import { closePool } from './db/postgres';
import { closeRedis } from './db/redis';

async function main() {
  const server = await buildServer();

  try {
    await server.listen({ port: config.PORT, host: '0.0.0.0' });
    logger.info({ port: config.PORT }, 'AI Gateway listening');
  } catch (err) {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  }

  // ── Graceful shutdown ────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');

    try {
      // Stop accepting new connections; finish in-flight requests
      await server.close();
      await Promise.all([closePool(), closeRedis()]);
      logger.info('Graceful shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'Uncaught exception');
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection');
    process.exit(1);
  });
}

main();
