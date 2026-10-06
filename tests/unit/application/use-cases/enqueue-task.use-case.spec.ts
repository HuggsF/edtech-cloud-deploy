import { TaskEnqueueFailedError } from '@application/errors/task-enqueue-failed.error';
import { UnexpectedError } from '@application/errors/unexpected.error';
import { decodeTaskMessage } from '@application/services/task-message.codec';
import { EnqueueTaskUseCase } from '@application/use-cases/enqueue-task.use-case';
import { InvalidTaskPayloadError } from '@domain/errors/invalid-task-payload.error';
import { InvalidTaskTypeError } from '@domain/errors/invalid-task-type.error';
import {
  FakeMessageBroker,
  FixedClock,
  InMemoryTaskRepository,
  RecordingMetrics,
  SequentialIdGenerator,
  VALID_PAYLOADS,
  createLoggerMock,
} from '../../../support/fakes';

const QUEUE = 'edtech.tasks';
const FIRST_ID = '0199b1c2-0000-7000-8000-000000000001';

describe('EnqueueTaskUseCase', () => {
  let repository: InMemoryTaskRepository;
  let broker: FakeMessageBroker;
  let metrics: RecordingMetrics;
  let logger: ReturnType<typeof createLoggerMock>;
  let useCase: EnqueueTaskUseCase;

  beforeEach(() => {
    repository = new InMemoryTaskRepository();
    broker = new FakeMessageBroker();
    metrics = new RecordingMetrics();
    logger = createLoggerMock();
    useCase = new EnqueueTaskUseCase(
      repository,
      broker,
      new SequentialIdGenerator(),
      new FixedClock(),
      metrics,
      logger,
      { queue: QUEUE },
    );
  });

  it('stores the task as pending, then publishes its id', async () => {
    const result = await useCase.execute({
      type: 'report_generation',
      payload: VALID_PAYLOADS.report_generation,
    });

    expect(result).toEqual({
      success: true,
      data: {
        taskId: FIRST_ID,
        type: 'report_generation',
        status: 'pending',
        createdAt: '2026-01-01T12:00:00.000Z',
      },
    });
    expect(repository.tasks.get(FIRST_ID)?.status.value).toBe('pending');
    expect(broker.published).toHaveLength(1);
    const [published] = broker.published;
    expect(published?.queue).toBe(QUEUE);
    const message = decodeTaskMessage(published!.message);
    expect(message).toEqual({
      success: true,
      data: { taskId: FIRST_ID, type: 'report_generation', enqueuedAt: '2026-01-01T12:00:00.000Z' },
    });
    expect(metrics.counters).toEqual([
      { name: 'task_enqueued_total', labels: { type: 'report_generation' } },
    ]);
  });

  it('rejects an unknown type without touching the database or the queue', async () => {
    const result = await useCase.execute({ type: 'sms', payload: {} });

    expect(!result.success && result.error).toBeInstanceOf(InvalidTaskTypeError);
    expect(repository.tasks.size).toBe(0);
    expect(broker.published).toHaveLength(0);
  });

  it('rejects an invalid payload with every issue', async () => {
    const result = await useCase.execute({ type: 'email_notification', payload: { to: 'x' } });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(InvalidTaskPayloadError);
      expect((result.error as InvalidTaskPayloadError).issues).toHaveLength(3);
    }
  });

  it('returns an UnexpectedError when the task cannot be stored, and publishes nothing', async () => {
    repository.failNextWith = new Error('ER_LOCK_WAIT_TIMEOUT');

    const result = await useCase.execute({ type: 'data_sync', payload: VALID_PAYLOADS.data_sync });

    expect(!result.success && result.error).toBeInstanceOf(UnexpectedError);
    expect(!result.success && result.error.message).toContain('ER_LOCK_WAIT_TIMEOUT');
    expect(broker.published).toHaveLength(0);
  });

  it('marks the task failed when the broker does not confirm the message', async () => {
    broker.publishError = new Error('Publisher confirm not received within 5000 ms');

    const result = await useCase.execute({ type: 'data_sync', payload: VALID_PAYLOADS.data_sync });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(TaskEnqueueFailedError);
      expect(result.error.code).toBe('TASK_ENQUEUE_FAILED');
    }
    const stored = repository.tasks.get(FIRST_ID);
    expect(stored?.status.value).toBe('failed');
    expect(stored?.error).toBe('Task could not be published to the queue');
    expect(metrics.counters).toHaveLength(0);
  });

  it('still reports the enqueue failure if marking the task failed also fails', async () => {
    broker.publishError = new Error('connection closed');
    repository.failUpdatesWith = new Error('database gone');

    const result = await useCase.execute({ type: 'data_sync', payload: VALID_PAYLOADS.data_sync });

    expect(!result.success && result.error).toBeInstanceOf(TaskEnqueueFailedError);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: FIRST_ID }),
      'Could not mark the task as failed',
    );
  });
});
