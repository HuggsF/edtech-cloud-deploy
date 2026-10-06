import type { QueueDepthSample } from '@application/dtos/queue-metrics.dto';

/**
 * Publishes the signal the cloud auto-scaler acts on. In AWS this is the custom CloudWatch
 * metric `Custom/EdTech QueueDepth`, consumed by the ECS target-tracking policy
 * (see docs/adr/002-queue-based-autoscaling.md). Disabled locally (no-op adapter).
 */
export interface AutoscalingMetricsPublisher {
  publishQueueDepth(samples: readonly QueueDepthSample[]): Promise<void>;
}
