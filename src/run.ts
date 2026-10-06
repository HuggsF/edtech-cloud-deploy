import { loadConfig, loadEnvFile } from '@infrastructure/config/env';
import type { ServiceRole } from '@infrastructure/config/env';
import { registerGracefulShutdown } from '@infrastructure/lifecycle/graceful-shutdown';
import { createLogger } from '@infrastructure/logging/logger';
import { startApi } from '@presentation/bootstrap/start-api';
import { startWorker } from '@presentation/bootstrap/start-worker';

/**
 * Shared process bootstrap of the API and the worker: validated config → start → wire SIGTERM.
 * ECS sends SIGTERM, waits `stopTimeout`, then SIGKILL; the shutdown deadline is shorter.
 */
export const run = (role: ServiceRole): void => {
  const start = async (): Promise<void> => {
    loadEnvFile();
    const config = loadConfig();
    const logger = createLogger({ ...config.log, name: `edtech-${role}` });
    const service =
      role === 'api' ? await startApi(config, logger) : await startWorker(config, logger);

    const { shutdown } = registerGracefulShutdown({
      logger,
      timeoutMs: config.shutdown.timeoutMs,
      tasks: service.shutdownTasks,
    });
    // Let it crash: a replica without a broker connection is replaced by the orchestrator.
    service.container.broker.onConnectionLost(() => {
      void shutdown('rabbitmq-connection-lost', 1);
    });
  };

  start().catch((error: unknown) => {
    process.stderr.write(`Fatal: the ${role} failed to start\n${String(error)}\n`);
    process.exit(1);
  });
};
