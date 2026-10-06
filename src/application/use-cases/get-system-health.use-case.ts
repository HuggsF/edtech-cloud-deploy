import type { DependencyStatus, HealthOutput } from '@application/dtos/health.dto';
import type { Clock } from '@application/interfaces/clock';
import type { HealthIndicator } from '@application/interfaces/health-indicator';
import { ok } from '@domain/shared/result';
import type { Result } from '@domain/shared/result';

export type GetSystemHealthOptions = {
  /** api | worker — tells which replica answered. */
  readonly service: string;
  readonly startedAt: Date;
  readonly timeoutMs?: number;
};

/**
 * Checks every dependency (MySQL, RabbitMQ) in parallel, each bounded by a timeout so /health
 * never hangs. Used by the ALB target group, the ECS container health check and Docker.
 */
export class GetSystemHealthUseCase {
  constructor(
    private readonly indicators: readonly HealthIndicator[],
    private readonly clock: Clock,
    private readonly options: GetSystemHealthOptions,
  ) {}

  async execute(): Promise<Result<HealthOutput, never>> {
    const statuses = await Promise.all(
      this.indicators.map(async (indicator): Promise<[string, DependencyStatus]> => [
        indicator.name,
        await this.probe(indicator),
      ]),
    );
    return ok({
      status: statuses.every(([, status]) => status === 'up') ? 'ok' : 'degraded',
      service: this.options.service,
      uptimeSeconds: Math.max(
        0,
        Math.round((this.clock.now().getTime() - this.options.startedAt.getTime()) / 1000),
      ),
      checks: Object.fromEntries(statuses),
    });
  }

  private async probe(indicator: HealthIndicator): Promise<DependencyStatus> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`${indicator.name} health check timed out`));
      }, this.options.timeoutMs ?? 2000);
    });
    try {
      await Promise.race([indicator.check(), timeout]);
      return 'up';
    } catch {
      return 'down';
    } finally {
      clearTimeout(timer);
    }
  }
}
