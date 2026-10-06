import type { Logger } from '@application/interfaces/logger';
import { createContainer } from '@infrastructure/config/container';
import type { Container, ContainerOverrides } from '@infrastructure/config/container';
import type { AppConfig } from '@infrastructure/config/env';
import { migrateLatest } from '@infrastructure/database/migrator';
import type { ShutdownTask } from '@infrastructure/lifecycle/graceful-shutdown';
import { PeriodicTask } from '@infrastructure/lifecycle/periodic-task';
import { createHttpApp } from '@presentation/http/app';
import { HealthController } from '@presentation/http/controllers/health.controller';
import { MetricsController } from '@presentation/http/controllers/metrics.controller';
import { TaskController } from '@presentation/http/controllers/task.controller';
import { boundPort, closeServer, listen, trackConnections } from '@presentation/http/server';

export type RunningService = {
  readonly container: Container;
  /** Port actually bound (useful with port 0 in tests). */
  readonly port: number;
  /** Ordered: stop taking work → finish work → release connections. */
  readonly shutdownTasks: readonly ShutdownTask[];
};

/** API process: HTTP endpoints + periodic queue-depth sampling (Prometheus + CloudWatch). */
export const startApi = async (
  config: AppConfig,
  logger: Logger,
  overrides: ContainerOverrides = {},
): Promise<RunningService> => {
  const container = await createContainer(config, logger, 'api', overrides);
  try {
    if (config.database.migrateOnStart) {
      const applied = await migrateLatest(container.db);
      logger.info({ applied }, 'Database migrations applied');
    }

    let accepting = true;
    const app = createHttpApp({
      logger,
      healthController: new HealthController(container.getSystemHealth, () => accepting),
      metricsController: new MetricsController(container.metrics),
      taskController: new TaskController(
        container.enqueueTask,
        container.getTaskStatus,
        container.getTaskStats,
      ),
    });
    const server = await listen(app, config.http.port);
    const openHttpConnections = trackConnections(server);
    container.metrics.collectGauge('active_connections', () => [
      { labels: { resource: 'http' }, value: openHttpConnections() },
    ]);

    const queueSampler = new PeriodicTask({
      name: 'queue-metrics',
      intervalMs: config.metrics.queueSampleIntervalMs,
      logger,
      run: async () => {
        const result = await container.recordQueueMetrics.execute();
        if (!result.success) {
          logger.warn({ err: result.error }, 'Queue metrics not recorded');
        }
      },
    });
    queueSampler.start();

    const port = boundPort(server);
    logger.info({ port, env: config.env }, 'API listening');
    return {
      container,
      port,
      shutdownTasks: [
        {
          name: 'http-server',
          close: async () => {
            accepting = false;
            await closeServer(server);
          },
        },
        { name: 'queue-metrics-sampler', close: () => queueSampler.stop() },
        { name: 'rabbitmq', close: () => container.broker.close() },
        { name: 'database', close: () => container.db.destroy() },
      ],
    };
  } catch (error: unknown) {
    await container.broker.close();
    await container.db.destroy();
    throw error;
  }
};
