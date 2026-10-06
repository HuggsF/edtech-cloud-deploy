import type { QueueDepthSample } from '@application/dtos/queue-metrics.dto';
import { UnexpectedError } from '@application/errors/unexpected.error';
import type { AutoscalingMetricsPublisher } from '@application/interfaces/autoscaling-metrics-publisher';
import type { Clock } from '@application/interfaces/clock';
import type { MessageBroker } from '@application/interfaces/message-broker';
import type { MetricsExporter } from '@application/interfaces/metrics-exporter';
import { fail, ok } from '@domain/shared/result';
import type { Result } from '@domain/shared/result';

export type RecordQueueMetricsOptions = {
  /** The work queue and its dead-letter queue. */
  readonly queues: readonly string[];
};

/**
 * Samples the depth of every queue and exports it twice: as the Prometheus `queue_depth` gauge
 * (Grafana) and as the CloudWatch metric the ECS auto-scaling policy tracks. Runs periodically
 * in the API service, which is not itself scaled by this metric.
 */
export class RecordQueueMetricsUseCase {
  constructor(
    private readonly broker: Pick<MessageBroker, 'getQueueDepth'>,
    private readonly metrics: Pick<MetricsExporter, 'exportGauge'>,
    private readonly publisher: AutoscalingMetricsPublisher,
    private readonly clock: Clock,
    private readonly options: RecordQueueMetricsOptions,
  ) {}

  async execute(): Promise<Result<readonly QueueDepthSample[], UnexpectedError>> {
    let samples: QueueDepthSample[];
    try {
      samples = await Promise.all(
        this.options.queues.map(async (queue): Promise<QueueDepthSample> => ({
          queue,
          depth: await this.broker.getQueueDepth(queue),
          sampledAt: this.clock.now(),
        })),
      );
    } catch (error: unknown) {
      return fail(new UnexpectedError('Sampling the queue depth', error));
    }

    for (const sample of samples) {
      this.metrics.exportGauge('queue_depth', sample.depth, { queue: sample.queue });
    }
    try {
      await this.publisher.publishQueueDepth(samples);
    } catch (error: unknown) {
      return fail(new UnexpectedError('Publishing the queue depth', error));
    }
    return ok(samples);
  }
}
