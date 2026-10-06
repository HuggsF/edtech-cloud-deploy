import { UnexpectedError } from '@application/errors/unexpected.error';
import { RecordQueueMetricsUseCase } from '@application/use-cases/record-queue-metrics.use-case';
import {
  FakeMessageBroker,
  FixedClock,
  RecordingAutoscalingPublisher,
  RecordingMetrics,
} from '../../../support/fakes';

const QUEUES = ['edtech.tasks', 'edtech.tasks.dlq'];

describe('RecordQueueMetricsUseCase', () => {
  let broker: FakeMessageBroker;
  let metrics: RecordingMetrics;
  let publisher: RecordingAutoscalingPublisher;
  let useCase: RecordQueueMetricsUseCase;

  beforeEach(() => {
    broker = new FakeMessageBroker();
    metrics = new RecordingMetrics();
    publisher = new RecordingAutoscalingPublisher();
    useCase = new RecordQueueMetricsUseCase(broker, metrics, publisher, new FixedClock(), {
      queues: QUEUES,
    });
  });

  it('exports every queue depth to Prometheus and to the auto-scaling metric', async () => {
    broker.depths.set('edtech.tasks', 1200);
    broker.depths.set('edtech.tasks.dlq', 3);

    const result = await useCase.execute();

    const sampledAt = new Date('2026-01-01T12:00:00.000Z');
    const samples = [
      { queue: 'edtech.tasks', depth: 1200, sampledAt },
      { queue: 'edtech.tasks.dlq', depth: 3, sampledAt },
    ];
    expect(result).toEqual({ success: true, data: samples });
    expect(metrics.gauges).toEqual([
      { name: 'queue_depth', value: 1200, labels: { queue: 'edtech.tasks' } },
      { name: 'queue_depth', value: 3, labels: { queue: 'edtech.tasks.dlq' } },
    ]);
    expect(publisher.batches).toEqual([samples]);
  });

  it('fails without exporting stale values when the broker cannot be queried', async () => {
    broker.depthError = new Error('channel closed');

    const result = await useCase.execute();

    expect(!result.success && result.error).toBeInstanceOf(UnexpectedError);
    expect(metrics.gauges).toHaveLength(0);
    expect(publisher.batches).toHaveLength(0);
  });

  it('keeps the Prometheus gauge even if CloudWatch rejects the data', async () => {
    publisher.error = new Error('AccessDenied: cloudwatch:PutMetricData');

    const result = await useCase.execute();

    expect(!result.success && result.error.message).toContain('AccessDenied');
    expect(metrics.gauges).toHaveLength(2);
  });
});
