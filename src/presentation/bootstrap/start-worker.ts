import type { Logger } from '@application/interfaces/logger';
import { createContainer } from '@infrastructure/config/container';
import type { ContainerOverrides } from '@infrastructure/config/container';
import type { AppConfig } from '@infrastructure/config/env';
import { InFlightTracker } from '@infrastructure/lifecycle/in-flight-tracker';
import { createHttpApp } from '@presentation/http/app';
import { HealthController } from '@presentation/http/controllers/health.controller';
import { MetricsController } from '@presentation/http/controllers/metrics.controller';
import { boundPort, closeServer, listen } from '@presentation/http/server';
import { TaskMessageHandler } from '@presentation/worker/task-message.handler';
import { WorkerRuntime } from '@presentation/worker/worker-runtime';
import type { RunningService } from './start-api';

export type RunningWorker = RunningService & {
  readonly runtime: WorkerRuntime;
  readonly inFlight: InFlightTracker;
};

/**
 * Worker process: consumes the task queue. It also serves /metrics and /health on
 * METRICS_PORT so Prometheus can scrape every replica and the orchestrator can probe it.
 */
export const startWorker = async (
  config: AppConfig,
  logger: Logger,
  overrides: ContainerOverrides = {},
): Promise<RunningWorker> => {
  const container = await createContainer(config, logger, 'worker', overrides);
  try {
    const inFlight = new InFlightTracker();
    container.metrics.collectGauge('tasks_in_flight', () => [{ value: inFlight.size }]);

    const handler = new TaskMessageHandler(
      container.processTask,
      container.broker,
      container.metrics,
      logger,
      { requeueDelayMs: config.tasks.requeueDelayMs },
    );
    const runtime = new WorkerRuntime(container.broker, handler, inFlight, logger, {
      queue: config.rabbitmq.queue,
      drainTimeoutMs: config.shutdown.drainTimeoutMs,
    });

    const app = createHttpApp({
      logger,
      healthController: new HealthController(
        container.getSystemHealth,
        () => runtime.isAcceptingWork,
      ),
      metricsController: new MetricsController(container.metrics),
    });
    const server = await listen(app, config.http.metricsPort);
    await runtime.start();

    const port = boundPort(server);
    logger.info({ metricsPort: port, prefetch: config.rabbitmq.prefetch }, 'Worker started');
    return {
      container,
      port,
      runtime,
      inFlight,
      shutdownTasks: [
        // 1. stop consuming + 2. wait for in-flight messages (bounded by the drain timeout)
        {
          name: 'consumer',
          close: async () => {
            await runtime.stop();
          },
        },
        { name: 'metrics-server', close: () => closeServer(server) },
        // 3. close channels + connection (unacked messages go back to the queue)
        { name: 'rabbitmq', close: () => container.broker.close() },
        // 4. release the MySQL pool
        { name: 'database', close: () => container.db.destroy() },
      ],
    };
  } catch (error: unknown) {
    await container.broker.close();
    await container.db.destroy();
    throw error;
  }
};
