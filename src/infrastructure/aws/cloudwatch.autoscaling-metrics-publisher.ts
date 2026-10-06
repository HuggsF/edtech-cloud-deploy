import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import type { QueueDepthSample } from '@application/dtos/queue-metrics.dto';
import type { AutoscalingMetricsPublisher } from '@application/interfaces/autoscaling-metrics-publisher';

/** The metric the ECS target-tracking policy is built on (infra/terraform/modules/autoscaling). */
export const QUEUE_DEPTH_METRIC = 'QueueDepth';
export const QUEUE_NAME_DIMENSION = 'QueueName';

export type PutMetricDataSender = {
  send(command: PutMetricDataCommand): Promise<unknown>;
};

export type CloudWatchPublisherConfig = {
  readonly namespace: string;
  readonly region: string;
  /** LocalStack (http://localstack:4566); undefined = the real regional endpoint. */
  readonly endpoint: string | undefined;
};

/**
 * Publishes `Custom/EdTech QueueDepth{QueueName=…}` with PutMetricData. Credentials come from
 * the default provider chain — on ECS, the task role (no keys in the container).
 *
 * Why the application publishes it: Amazon MQ does not vend per-queue CloudWatch metrics for
 * RabbitMQ 4 brokers (see docs/adr/002-queue-based-autoscaling.md).
 */
export class CloudWatchAutoscalingMetricsPublisher implements AutoscalingMetricsPublisher {
  constructor(
    private readonly client: PutMetricDataSender,
    private readonly namespace: string,
  ) {}

  static create(config: CloudWatchPublisherConfig): CloudWatchAutoscalingMetricsPublisher {
    const client = new CloudWatchClient({
      region: config.region,
      ...(config.endpoint === undefined ? {} : { endpoint: config.endpoint }),
    });
    return new CloudWatchAutoscalingMetricsPublisher(client, config.namespace);
  }

  async publishQueueDepth(samples: readonly QueueDepthSample[]): Promise<void> {
    if (samples.length === 0) {
      return;
    }
    await this.client.send(
      new PutMetricDataCommand({
        Namespace: this.namespace,
        MetricData: samples.map((sample) => ({
          MetricName: QUEUE_DEPTH_METRIC,
          Dimensions: [{ Name: QUEUE_NAME_DIMENSION, Value: sample.queue }],
          Timestamp: sample.sampledAt,
          Value: sample.depth,
          Unit: 'Count',
        })),
      }),
    );
  }
}

/** Local development: the auto-scaler does not exist, Prometheus is enough. */
export class NoopAutoscalingMetricsPublisher implements AutoscalingMetricsPublisher {
  publishQueueDepth(_samples: readonly QueueDepthSample[]): Promise<void> {
    return Promise.resolve();
  }
}
