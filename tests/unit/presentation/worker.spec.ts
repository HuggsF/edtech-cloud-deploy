import type { ProcessTaskOutcome } from '@application/dtos/task.dto';
import { TaskNotFoundError } from '@application/errors/task-not-found.error';
import { UnexpectedError } from '@application/errors/unexpected.error';
import type { ProcessTaskUseCase } from '@application/use-cases/process-task.use-case';
import { fail, ok } from '@domain/shared/result';
import { InFlightTracker } from '@infrastructure/lifecycle/in-flight-tracker';
import { TaskMessageHandler } from '@presentation/worker/task-message.handler';
import { WorkerRuntime } from '@presentation/worker/worker-runtime';
import {
  FakeMessageBroker,
  RecordingMetrics,
  TASK_ID,
  createLoggerMock,
  encodeJson,
} from '../../support/fakes';

type Execute = ProcessTaskUseCase['execute'];

const QUEUE = 'edtech.tasks';
const MESSAGE = encodeJson({
  taskId: TASK_ID,
  type: 'data_sync',
  enqueuedAt: '2026-01-01T12:00:00Z',
});

const outcome = (value: ProcessTaskOutcome): Awaited<ReturnType<Execute>> =>
  ok({ taskId: TASK_ID, outcome: value, status: 'completed', attempts: 1, durationMs: 5 });

describe('TaskMessageHandler', () => {
  let broker: FakeMessageBroker;
  let metrics: RecordingMetrics;
  let execute: jest.Mock<ReturnType<Execute>, Parameters<Execute>>;
  let delay: jest.Mock<Promise<unknown>, [number]>;
  let handler: TaskMessageHandler;

  beforeEach(async () => {
    broker = new FakeMessageBroker();
    metrics = new RecordingMetrics();
    execute = jest.fn<ReturnType<Execute>, Parameters<Execute>>();
    delay = jest.fn<Promise<unknown>, [number]>().mockResolvedValue(undefined);
    handler = new TaskMessageHandler(
      { execute },
      broker,
      metrics,
      createLoggerMock(),
      { requeueDelayMs: 2000 },
      delay,
    );
    await broker.consume(QUEUE, handler.handle);
  });

  it.each<[ProcessTaskOutcome, string]>([
    ['completed', 'ack'],
    ['failed', 'ack'],
    ['skipped', 'ack'],
    ['retry', 'requeue'],
  ])('a %s outcome is settled with %s (after the status is persisted)', async (value, action) => {
    execute.mockResolvedValue(outcome(value));

    await broker.deliver(QUEUE, MESSAGE);

    expect(execute).toHaveBeenCalledWith({ taskId: TASK_ID });
    expect(broker.lastAction()).toBe(action);
  });

  it('dead-letters a malformed message without calling the use case', async () => {
    await broker.deliver(QUEUE, new TextEncoder().encode('not json'));

    expect(execute).not.toHaveBeenCalled();
    expect(broker.lastAction()).toBe('dead-letter');
    expect(metrics.counters).toEqual([
      { name: 'messages_dead_lettered_total', labels: { reason: 'invalid_message' } },
    ]);
  });

  it('dead-letters a message whose task does not exist', async () => {
    execute.mockResolvedValue(fail(new TaskNotFoundError(TASK_ID)));

    await broker.deliver(QUEUE, MESSAGE);

    expect(broker.lastAction()).toBe('dead-letter');
    expect(metrics.counters[0]?.labels).toEqual({ reason: 'task_not_found' });
  });

  it('waits, then requeues, when the infrastructure fails', async () => {
    execute.mockResolvedValue(fail(new UnexpectedError('Processing', new Error('ECONNRESET'))));

    await broker.deliver(QUEUE, MESSAGE, true);

    expect(delay).toHaveBeenCalledWith(2000);
    expect(broker.lastAction()).toBe('requeue');
  });

  it('uses a real timer by default', async () => {
    const realHandler = new TaskMessageHandler(
      { execute: jest.fn().mockResolvedValue(fail(new UnexpectedError('x', 'y'))) },
      broker,
      metrics,
      createLoggerMock(),
      { requeueDelayMs: 1 },
    );

    await realHandler.handle({ content: MESSAGE, redelivered: false });

    expect(broker.lastAction()).toBe('requeue');
  });
});

describe('WorkerRuntime', () => {
  it('stops consuming first, then waits for every in-flight message before returning', async () => {
    const broker = new FakeMessageBroker();
    const events: string[] = [];
    let finishTask: () => void = () => undefined;
    const execute = jest.fn<ReturnType<Execute>, Parameters<Execute>>(
      () =>
        new Promise((resolve) => {
          finishTask = () => {
            events.push('task persisted');
            resolve(outcome('completed'));
          };
        }),
    );
    const tracker = new InFlightTracker();
    const handler = new TaskMessageHandler(
      { execute },
      broker,
      new RecordingMetrics(),
      createLoggerMock(),
      {
        requeueDelayMs: 0,
      },
    );
    const runtime = new WorkerRuntime(broker, handler, tracker, createLoggerMock(), {
      queue: QUEUE,
      drainTimeoutMs: 5000,
    });
    expect(runtime.isAcceptingWork).toBe(false);

    await runtime.start();
    expect(runtime.isAcceptingWork).toBe(true);
    const delivery = broker.deliver(QUEUE, MESSAGE);
    expect(tracker.size).toBe(1);

    const stopping = runtime.stop().then((report) => {
      events.push('stopped');
      return report;
    });
    await Promise.resolve();
    expect(broker.stopped).toBe(true);
    expect(runtime.isAcceptingWork).toBe(false);

    finishTask();
    await delivery;
    const report = await stopping;

    expect(events).toEqual(['task persisted', 'stopped']);
    expect(report).toMatchObject({ inFlightAtStop: 1, drained: true });
    expect(broker.lastAction()).toBe('ack');
  });

  it('gives up after the drain timeout and reports it', async () => {
    const broker = new FakeMessageBroker();
    const logger = createLoggerMock();
    const execute = jest.fn<ReturnType<Execute>, Parameters<Execute>>(
      () => new Promise(() => undefined),
    );
    const handler = new TaskMessageHandler({ execute }, broker, new RecordingMetrics(), logger, {
      requeueDelayMs: 0,
    });
    const runtime = new WorkerRuntime(broker, handler, new InFlightTracker(), logger, {
      queue: QUEUE,
      drainTimeoutMs: 20,
    });
    await runtime.start();
    void broker.deliver(QUEUE, MESSAGE);

    const report = await runtime.stop();

    expect(report).toMatchObject({ inFlightAtStop: 1, drained: false });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ stillInFlight: 1 }),
      'Drain timeout reached: unacknowledged messages will be redelivered to another worker',
    );
  });
});
