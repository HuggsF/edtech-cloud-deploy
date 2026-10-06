import { TaskNotFoundError } from '@application/errors/task-not-found.error';
import { UnexpectedError } from '@application/errors/unexpected.error';
import { GetSystemHealthUseCase } from '@application/use-cases/get-system-health.use-case';
import { GetTaskStatsUseCase } from '@application/use-cases/get-task-stats.use-case';
import { GetTaskStatusUseCase } from '@application/use-cases/get-task-status.use-case';
import {
  FakeMessageBroker,
  FixedClock,
  InMemoryTaskRepository,
  TASK_ID,
  VALID_PAYLOADS,
  buildTask,
  createLoggerMock,
  must,
} from '../../../support/fakes';

describe('GetTaskStatusUseCase', () => {
  it('maps the task to a DTO (no domain object leaks out)', async () => {
    const repository = new InMemoryTaskRepository();
    const done = must(
      must(buildTask('data_sync').markAsProcessing()).markAsCompleted(
        'Synced',
        new Date('2026-01-01T12:00:03.000Z'),
      ),
    );
    await repository.save(done);

    const result = await new GetTaskStatusUseCase(repository).execute({ taskId: TASK_ID });

    expect(result).toEqual({
      success: true,
      data: {
        id: TASK_ID,
        type: 'data_sync',
        status: 'completed',
        payload: VALID_PAYLOADS.data_sync,
        attempts: 1,
        result: 'Synced',
        error: null,
        createdAt: '2026-01-01T12:00:00.000Z',
        processedAt: '2026-01-01T12:00:03.000Z',
      },
    });
  });

  it('returns TaskNotFoundError for an unknown id', async () => {
    const result = await new GetTaskStatusUseCase(new InMemoryTaskRepository()).execute({
      taskId: TASK_ID,
    });

    expect(!result.success && result.error).toBeInstanceOf(TaskNotFoundError);
    expect(!result.success && result.error.code).toBe('TASK_NOT_FOUND');
  });

  it('wraps repository failures', async () => {
    const repository = new InMemoryTaskRepository();
    repository.failNextWith = new Error('timeout');

    const result = await new GetTaskStatusUseCase(repository).execute({ taskId: TASK_ID });

    expect(!result.success && result.error).toBeInstanceOf(UnexpectedError);
  });
});

describe('GetTaskStatsUseCase', () => {
  const QUEUE = 'edtech.tasks';

  it('returns counts by status, the total and the live queue depth', async () => {
    const repository = new InMemoryTaskRepository();
    await repository.save(buildTask('data_sync', { id: 'a' }));
    await repository.save(must(buildTask('data_sync', { id: 'b' }).markAsProcessing()));
    await repository.save(must(buildTask('data_sync', { id: 'c' }).markAsFailed('x', new Date())));
    const broker = new FakeMessageBroker();
    broker.depths.set(QUEUE, 42);

    const result = await new GetTaskStatsUseCase(repository, broker, createLoggerMock(), {
      queue: QUEUE,
    }).execute();

    expect(result).toEqual({
      success: true,
      data: {
        byStatus: { pending: 1, processing: 1, completed: 0, failed: 1 },
        total: 3,
        queue: { name: QUEUE, depth: 42 },
      },
    });
  });

  it('still answers with the counts when the broker is unreachable', async () => {
    const broker = new FakeMessageBroker();
    broker.depthError = new Error('channel closed');
    const logger = createLoggerMock();

    const result = await new GetTaskStatsUseCase(new InMemoryTaskRepository(), broker, logger, {
      queue: QUEUE,
    }).execute();

    expect(result.success && result.data.queue).toEqual({ name: QUEUE, depth: null });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('fails when the counts cannot be read', async () => {
    const repository = new InMemoryTaskRepository();
    repository.failNextWith = new Error('db down');

    const result = await new GetTaskStatsUseCase(
      repository,
      new FakeMessageBroker(),
      createLoggerMock(),
      { queue: QUEUE },
    ).execute();

    expect(!result.success && result.error).toBeInstanceOf(UnexpectedError);
  });
});

describe('GetSystemHealthUseCase', () => {
  const startedAt = new Date('2026-01-01T11:59:00.000Z');

  it('is ok when every dependency answers', async () => {
    const result = await new GetSystemHealthUseCase(
      [
        { name: 'database', check: () => Promise.resolve() },
        { name: 'rabbitmq', check: () => Promise.resolve() },
      ],
      new FixedClock(),
      { service: 'worker', startedAt },
    ).execute();

    expect(result).toEqual({
      success: true,
      data: {
        status: 'ok',
        service: 'worker',
        uptimeSeconds: 60,
        checks: { database: 'up', rabbitmq: 'up' },
      },
    });
  });

  it('is degraded when a dependency fails or hangs past the timeout', async () => {
    const result = await new GetSystemHealthUseCase(
      [
        { name: 'database', check: () => Promise.reject(new Error('ECONNREFUSED')) },
        { name: 'rabbitmq', check: () => new Promise<void>(() => undefined) },
        { name: 'cache', check: () => Promise.resolve() },
      ],
      new FixedClock(),
      { service: 'api', startedAt, timeoutMs: 20 },
    ).execute();

    expect(result.success && result.data.status).toBe('degraded');
    expect(result.success && result.data.checks).toEqual({
      database: 'down',
      rabbitmq: 'down',
      cache: 'up',
    });
  });
});
