import { Router } from 'express';
import type { HealthController } from '@presentation/http/controllers/health.controller';
import type { MetricsController } from '@presentation/http/controllers/metrics.controller';

/** Endpoints for the platform (load balancer, orchestrator, Prometheus), not for clients. */
export const buildOperationsRouter = (
  health: HealthController,
  metrics: MetricsController,
): Router => {
  const router = Router();
  router.get('/health', health.check);
  router.get('/metrics', metrics.scrape);
  return router;
};
