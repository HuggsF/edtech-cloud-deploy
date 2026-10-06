import type { PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import {
  CloudWatchAutoscalingMetricsPublisher,
  NoopAutoscalingMetricsPublisher,
} from '@infrastructure/aws/cloudwatch.autoscaling-metrics-publisher';
import { PrometheusMetricsExporter } from '@infrastructure/metrics/prometheus.metrics-exporter';
import { DURATION_WEIGHTS, TimerWorkSimulator } from '@infrastructure/system/timer-work-simulator';

describe('PrometheusMetricsExporter', () => {
  it('exposes the SPEC metrics with a service label', async () => {
    const metrics = new PrometheusMetricsExporter({ service: 'worker', defaultMetrics: false });

    metrics.exportCounter('task_processed_total', { status: 'completed', type: 'data_sync' });
    metrics.exportCounter('task_processed_total', { status: 'completed', type: 'data_sync' });
    metrics.exportHistogram('task_processing_duration_seconds', 0.3, { type: 'data_sync' });
    metrics.exportGauge('queue_depth', 17, { queue: 'edtech.tasks' });
    metrics.collectGauge('active_connections', () => [{ labels: { resource: 'mysql' }, value: 3 }]);
    let inFlight = 4;
    metrics.collectGauge('tasks_in_flight', () => [{ value: inFlight }]);

    const output = await metrics.getMetricsOutput();

    expect(output).toContain(
      'task_processed_total{status="completed",type="data_sync",service="worker"} 2',
    );
    expect(output).toContain(
      'task_processing_duration_seconds_bucket{le="0.5",service="worker",type="data_sync"} 1',
    );
    expect(output).toContain(
      'task_processing_duration_seconds_count{service="worker",type="data_sync"} 1',
    );
    expect(output).toContain('queue_depth{queue="edtech.tasks",service="worker"} 17');
    expect(output).toContain('active_connections{resource="mysql",service="worker"} 3');
    expect(output).toContain('tasks_in_flight{service="worker"} 4');
    expect(output).toContain('# TYPE task_enqueued_total counter');
    expect(output).not.toContain('nodejs_');

    inFlight = 0;
    expect(await metrics.getMetricsOutput()).toContain('tasks_in_flight{service="worker"} 0');
    expect(metrics.contentType).toContain('text/plain');
  });

  it('includes the Node.js runtime metrics by default, in its own registry', async () => {
    const first = new PrometheusMetricsExporter({ service: 'api' });
    const second = new PrometheusMetricsExporter({ service: 'api' });

    expect(await first.getMetricsOutput()).toContain('nodejs_eventloop_lag_seconds');
    expect(first.registry).not.toBe(second.registry);
  });
});

describe('CloudWatchAutoscalingMetricsPublisher', () => {
  it('publishes Custom/EdTech QueueDepth per queue', async () => {
    const send = jest.fn<Promise<unknown>, [PutMetricDataCommand]>().mockResolvedValue({});
    const publisher = new CloudWatchAutoscalingMetricsPublisher({ send }, 'Custom/EdTech');
    const sampledAt = new Date('2026-01-01T12:00:00.000Z');

    await publisher.publishQueueDepth([
      { queue: 'edtech.tasks', depth: 250, sampledAt },
      { queue: 'edtech.tasks.dlq', depth: 0, sampledAt },
    ]);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].input).toEqual({
      Namespace: 'Custom/EdTech',
      MetricData: [
        {
          MetricName: 'QueueDepth',
          Dimensions: [{ Name: 'QueueName', Value: 'edtech.tasks' }],
          Timestamp: sampledAt,
          Value: 250,
          Unit: 'Count',
        },
        {
          MetricName: 'QueueDepth',
          Dimensions: [{ Name: 'QueueName', Value: 'edtech.tasks.dlq' }],
          Timestamp: sampledAt,
          Value: 0,
          Unit: 'Count',
        },
      ],
    });
  });

  it('sends nothing for an empty batch', async () => {
    const send = jest.fn<Promise<unknown>, [PutMetricDataCommand]>();

    await new CloudWatchAutoscalingMetricsPublisher({ send }, 'Custom/EdTech').publishQueueDepth(
      [],
    );

    expect(send).not.toHaveBeenCalled();
  });

  it('builds a real SDK client (optionally pointed at LocalStack)', async () => {
    const publisher = CloudWatchAutoscalingMetricsPublisher.create({
      namespace: 'Custom/EdTech',
      region: 'us-east-1',
      endpoint: 'http://localhost:4566',
    });

    expect(publisher).toBeInstanceOf(CloudWatchAutoscalingMetricsPublisher);
    await expect(
      new NoopAutoscalingMetricsPublisher().publishQueueDepth([]),
    ).resolves.toBeUndefined();
    expect(
      CloudWatchAutoscalingMetricsPublisher.create({
        namespace: 'Custom/EdTech',
        region: 'eu-west-1',
        endpoint: undefined,
      }),
    ).toBeInstanceOf(CloudWatchAutoscalingMetricsPublisher);
  });
});

describe('TimerWorkSimulator', () => {
  it('waits duration × type weight ± jitter and succeeds', async () => {
    const random = jest.fn().mockReturnValueOnce(1).mockReturnValueOnce(0.99);
    const simulator = new TimerWorkSimulator(
      { durationMs: 10, jitter: 0.5, failureRate: 0.05 },
      random,
    );

    const outcome = await simulator.perform('report_generation');

    // base 10 × 2 = 20 ms, + 50 % jitter = 30 ms
    expect(outcome).toEqual({ ok: true, durationMs: 30 });
    expect(DURATION_WEIGHTS.report_generation).toBe(2);
  });

  it('fails with a transient, type-specific reason at the configured rate', async () => {
    const random = jest.fn().mockReturnValueOnce(0.5).mockReturnValueOnce(0.01);
    const simulator = new TimerWorkSimulator(
      { durationMs: 0, jitter: 0, failureRate: 0.05 },
      random,
    );

    const outcome = await simulator.perform('email_notification');

    expect(outcome).toEqual({
      ok: false,
      durationMs: 0,
      reason: 'SMTP server timed out (simulated)',
    });
  });
});
