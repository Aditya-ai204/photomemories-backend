import { app } from './app';
import { env } from './config/env';
import { logger } from './utils/logger';
import { closePool } from './database';

const server = app.listen(env.PORT, () => {
  logger.info(`PhotoMemories backend server running on port ${env.PORT} in ${env.NODE_ENV} mode`);
});

// Graceful shutdown
function handleShutdown(signal: string) {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  server.close(async () => {
    try {
      await closePool();
      logger.info('Server closed cleanly.');
      process.exit(0);
    } catch (err) {
      logger.error('Error during shutdown', err);
      process.exit(1);
    }
  });

  // Force close after 10s if hanging
  setTimeout(() => {
    logger.error('Forced shutdown due to timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
