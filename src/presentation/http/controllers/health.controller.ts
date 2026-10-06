import type { Request, Response } from 'express';
import type { GetSystemHealthUseCase } from '@application/use-cases/get-system-health.use-case';

export type ReadinessProbe = () => boolean;

export class HealthController {
  constructor(
    private readonly getSystemHealth: Pick<GetSystemHealthUseCase, 'execute'>,
    /** false while the process is shutting down: the load balancer stops routing to it. */
    private readonly isAcceptingWork: ReadinessProbe = () => true,
  ) {}

  /** GET /health — 200 when every dependency is up, 503 otherwise (ALB / ECS / Docker probe). */
  check = async (_request: Request, response: Response): Promise<void> => {
    const result = await this.getSystemHealth.execute();
    if (!result.success) {
      response.status(503).json({ status: 'degraded' });
      return;
    }
    if (!this.isAcceptingWork()) {
      response.status(503).json({ ...result.data, status: 'shutting_down' });
      return;
    }
    response.status(result.data.status === 'ok' ? 200 : 503).json(result.data);
  };
}
