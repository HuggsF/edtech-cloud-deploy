import type { Request, Response } from 'express';
import type { MetricsExporter } from '@application/interfaces/metrics-exporter';

export const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

export class MetricsController {
  constructor(private readonly metrics: Pick<MetricsExporter, 'getMetricsOutput'>) {}

  /** GET /metrics — Prometheus text exposition format. */
  scrape = async (_request: Request, response: Response): Promise<void> => {
    const output = await this.metrics.getMetricsOutput();
    response.status(200).type(PROMETHEUS_CONTENT_TYPE).send(output);
  };
}
