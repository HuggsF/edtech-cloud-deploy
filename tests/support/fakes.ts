import type { QueueDepthSample } from '@application/dtos/queue-metrics.dto';
import type { AutoscalingMetricsPublisher } from '@application/interfaces/autoscaling-metrics-publisher';
import type { Clock } from '@application/interfaces/clock';
import type { IdGenerator } from '@application/interfaces/id-generator';
import type { LogContext, Logger } from '@application/interfaces/logger';
import type {
  ConsumedMessage,
  MessageBroker,
  MessageHandler,
} from '@application/interfaces/message-broker';
import type {
  CounterName,
  GaugeName,
  HistogramName,
  MetricLabels,
  MetricsExporter,
} from '@application/interfaces/metrics-exporter';
import type { SimulatedWorkOutcome, WorkSimulator } from '@application/interfaces/work-simulator';
import { Task } from '@domain/entities/task.entity';
import type { TaskRepository, TaskCountByStatus } from '@domain/repositories/task.repository';
import type { TaskTypeValue } from '@domain/value-objects/task-type.value-object';

export const VALID_PAYLOADS: Readonly<Record<TaskTypeValue, Record<string, unknown>>> = {
  email_notification: {
    to: 'Ana.Souza@School.edu',
    template: 'welcome',
    subject: 'Welcome to EdTech!',
  },
  report_generation: { reportType: 'grade_summary', courseId: 'MATH-101', format: 'pdf' },
  data_sync: { source: 'sis', entity: 'students', since: '2026-01-01', batchSize: 200 },
  certificate_generation: {
    studentId: 'STU-42',
    studentName: 'Ana Souza',
    courseId: 'MATH-101',
  },
};

export const TASK_ID = '0199b1c2-0000-7000-8000-000000000001';

export const buildTask = (
  type: TaskTypeValue = 'email_notification',
  overrides: Partial<{ id: string; payload: unknown; createdAt: Date }> = {},
): Task => {
  const result = Task.create({
    id: overrides.id ?? TASK_ID,
    type,
    payload: overrides.payload ?? VALID_PAYLOADS[type],
    createdAt: overrides.createdAt ?? new Date('2026-01-01T12:00:00.000Z'),
  });
  if (!result.success) {
    throw result.error;
  }
  return result.data;
};

/** Unwraps a successful transition (test helper). */
export const must = <T>(
  result: { success: true; data: T } | { success: false; error: Error },
): T => {
  if (!result.success) {
    throw result.error;
  }
  return result.data;
};

export class InMemoryTaskRepository implements TaskRepository {
  readonly tasks = new Map<string, Task>();
  readonly history: Task[] = [];
  failNextWith: Error | null = null;
  failUpdatesWith: Error | null = null;

  async save(task: Task): Promise<void> {
    await Promise.resolve();
    this.throwIfFailing();
    this.tasks.set(task.id, task);
    this.history.push(task);
  }

  async findById(id: string): Promise<Task | null> {
    await Promise.resolve();
    this.throwIfFailing();
    return this.tasks.get(id) ?? null;
  }

  async updateStatus(task: Task): Promise<void> {
    await Promise.resolve();
    this.throwIfFailing();
    if (this.failUpdatesWith !== null) {
      throw this.failUpdatesWith;
    }
    if (!this.tasks.has(task.id)) {
      throw new Error(`Task ${task.id} does not exist`);
    }
    this.tasks.set(task.id, task);
    this.history.push(task);
  }

  async countByStatus(): Promise<TaskCountByStatus> {
    await Promise.resolve();
    this.throwIfFailing();
    const counts = { pending: 0, processing: 0, completed: 0, failed: 0 };
    for (const task of this.tasks.values()) {
      counts[task.status.value] += 1;
    }
    return counts;
  }

  private throwIfFailing(): void {
    if (this.failNextWith !== null) {
      const error = this.failNextWith;
      this.failNextWith = null;
      throw error;
    }
  }
}

type Settlement = {
  readonly message: ConsumedMessage;
  readonly action: 'ack' | 'requeue' | 'dead-letter';
};

export class FakeMessageBroker implements MessageBroker {
  readonly published: { queue: string; message: Uint8Array }[] = [];
  readonly settlements: Settlement[] = [];
  readonly depths = new Map<string, number>();
  readonly handlers = new Map<string, MessageHandler>();
  publishError: Error | null = null;
  depthError: Error | null = null;
  stopped = false;

  async publish(queue: string, message: Uint8Array): Promise<void> {
    await Promise.resolve();
    if (this.publishError !== null) {
      throw this.publishError;
    }
    this.published.push({ queue, message });
  }

  async consume(queue: string, handler: MessageHandler): Promise<void> {
    await Promise.resolve();
    this.handlers.set(queue, handler);
  }

  ack(message: ConsumedMessage): void {
    this.settlements.push({ message, action: 'ack' });
  }

  nack(message: ConsumedMessage, requeue: boolean): void {
    this.settlements.push({ message, action: requeue ? 'requeue' : 'dead-letter' });
  }

  async getQueueDepth(queue: string): Promise<number> {
    await Promise.resolve();
    if (this.depthError !== null) {
      throw this.depthError;
    }
    return this.depths.get(queue) ?? 0;
  }

  async stopConsuming(): Promise<void> {
    await Promise.resolve();
    this.stopped = true;
    this.handlers.clear();
  }

  /** Simulates a delivery to the registered consumer. */
  deliver(queue: string, content: Uint8Array, redelivered = false): Promise<void> {
    const handler = this.handlers.get(queue);
    if (handler === undefined) {
      throw new Error(`No consumer on ${queue}`);
    }
    return handler({ content, redelivered });
  }

  lastAction(): Settlement['action'] | undefined {
    return this.settlements.at(-1)?.action;
  }
}

type Recorded = { readonly name: string; readonly value?: number; readonly labels: MetricLabels };

export class RecordingMetrics implements MetricsExporter {
  readonly counters: Recorded[] = [];
  readonly gauges: Recorded[] = [];
  readonly histograms: Recorded[] = [];

  exportGauge(name: GaugeName, value: number, labels: MetricLabels = {}): void {
    this.gauges.push({ name, value, labels });
  }

  exportCounter(name: CounterName, labels: MetricLabels = {}): void {
    this.counters.push({ name, labels });
  }

  exportHistogram(name: HistogramName, value: number, labels: MetricLabels = {}): void {
    this.histograms.push({ name, value, labels });
  }

  getMetricsOutput(): Promise<string> {
    return Promise.resolve(`# ${this.counters.length} counters`);
  }
}

/** Replays scripted outcomes (default: success after 0 ms). */
export class ScriptedWorkSimulator implements WorkSimulator {
  readonly calls: TaskTypeValue[] = [];

  constructor(private readonly outcomes: SimulatedWorkOutcome[] = []) {}

  perform(type: TaskTypeValue): Promise<SimulatedWorkOutcome> {
    this.calls.push(type);
    return Promise.resolve(this.outcomes.shift() ?? { ok: true, durationMs: 0 });
  }
}

export class RecordingAutoscalingPublisher implements AutoscalingMetricsPublisher {
  readonly batches: (readonly QueueDepthSample[])[] = [];
  error: Error | null = null;

  async publishQueueDepth(samples: readonly QueueDepthSample[]): Promise<void> {
    await Promise.resolve();
    if (this.error !== null) {
      throw this.error;
    }
    this.batches.push(samples);
  }
}

export class FixedClock implements Clock {
  constructor(private current = new Date('2026-01-01T12:00:00.000Z')) {}

  now(): Date {
    return this.current;
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** Every call to now() moves the clock forward by `stepMs` (measures durations). */
export class TickingClock implements Clock {
  private current: number;

  constructor(
    start = new Date('2026-01-01T12:00:00.000Z'),
    private readonly stepMs = 100,
  ) {
    this.current = start.getTime();
  }

  now(): Date {
    const now = new Date(this.current);
    this.current += this.stepMs;
    return now;
  }
}

export class SequentialIdGenerator implements IdGenerator {
  private next = 0;

  generate(): string {
    this.next += 1;
    return `0199b1c2-0000-7000-8000-${String(this.next).padStart(12, '0')}`;
  }
}

type LogFn = Logger['info'];
type LogMock = jest.Mock<ReturnType<LogFn>, Parameters<LogFn>>;

export type LoggerMock = { [K in keyof Logger]: LogMock };

const logMock = (): LogMock => jest.fn<ReturnType<LogFn>, [LogContext, string]>();

export const createLoggerMock = (): LoggerMock => ({
  debug: logMock(),
  info: logMock(),
  warn: logMock(),
  error: logMock(),
});

export const encodeJson = (value: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(value));
