import express from 'express';
import type { Express } from 'express';
import type { Logger } from '@application/interfaces/logger';
import type { HealthController } from '@presentation/http/controllers/health.controller';
import type { MetricsController } from '@presentation/http/controllers/metrics.controller';
import type { TaskController } from '@presentation/http/controllers/task.controller';
import { errorHandler } from '@presentation/http/middleware/error-handler.middleware';
import { notFoundHandler } from '@presentation/http/middleware/not-found.middleware';
import { requestLogger } from '@presentation/http/middleware/request-logger.middleware';
import { buildOperationsRouter } from '@presentation/http/routes/operations.routes';
import { buildTaskRouter } from '@presentation/http/routes/task.routes';

export const MAX_BODY_SIZE = '16kb';

export type HttpAppDependencies = {
  readonly logger: Logger;
  readonly healthController: HealthController;
  readonly metricsController: MetricsController;
  /** Omitted for the worker: it only exposes /health and /metrics. */
  readonly taskController?: TaskController;
};

export const createHttpApp = (dependencies: HttpAppDependencies): Express => {
  const app = express();
  app.disable('x-powered-by');

  app.use(requestLogger(dependencies.logger));
  app.use(buildOperationsRouter(dependencies.healthController, dependencies.metricsController));
  if (dependencies.taskController !== undefined) {
    app.use(
      '/api/tasks',
      express.json({ limit: MAX_BODY_SIZE }),
      buildTaskRouter(dependencies.taskController),
    );
  }

  app.use(notFoundHandler);
  app.use(errorHandler(dependencies.logger));
  return app;
};
