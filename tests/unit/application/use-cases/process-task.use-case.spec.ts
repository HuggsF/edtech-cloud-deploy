import { TaskNotFoundError } from '@application/errors/task-not-found.error';
import { TaskProcessingError } from '@application/errors/task-processing.error';
import { UnexpectedError } from '@application/errors/unexpected.error';
import type { TaskProcessor } from '@application/interfaces/task-processor';
import { TaskProcessorRegistry } from '@application/services/processors/task-processor.registry';
import { ProcessTaskUseCase } from '@application/use-cases/process-task.use-case';
import type { Task } from '@domain/entities/task.entity';
import { fail } from '@domain/shared/result';
import {
  InMemoryTaskRepository,
  RecordingMetrics,
  ScriptedWorkSimulator,
  TASK_ID,
  TickingClock,
  buildTask,
  createLoggerMock,
  must,
} from '../../../support/fakes';

const MAX_ATTEMPTS = 3;

describe('ProcessTaskUseCase', () => {
  let repository: InMemoryTaskRepository;
  let metrics: RecordingMetrics;
  let simulator: ScriptedWorkSimulator;

  const useCaseWith = (registry: TaskProcessorRegistry): ProcessTaskUseCase =>
    new ProcessTaskUseCase(repository, registry, new TickingClock(), metrics, createLoggerMock(), {
      maxAttempts: MAX_ATTEMPTS,
    });

  const seed = async (task: Task): Promise<void> => {
    await repository.save(task);
    repository.history.length = 0;
  };

  beforeEach(() => {
    repository = new InMemoryTaskRepository();
    metrics = new RecordingMetrics();
    simulator = new ScriptedWorkSimulator();
  });

  it('runs the processor and persists processing, then completed', async () => {
    await seed(buildTask('certificate_generation'));

    const result = await useCaseWith(
      TaskProcessorRegistry.withSimulatedProcessors(simulator),
    ).execute({
      taskId: TASK_ID,
    });

    expect(result).toEqual({
      success: true,
      data: {
        taskId: TASK_ID,
        outcome: 'completed',
        status: 'completed',
        attempts: 1,
        durationMs: expect.any(Number) as number,
      },
    });
    expect(repository.history.map((task) => task.status.value)).toEqual([
      'processing',
      'completed',
    ]);
    expect(repository.tasks.get(TASK_ID)?.result).toBe(
      'Certificate CERT-0000000001 issued to Ana Souza for course MATH-101',
    );
    expect(simulator.calls).toEqual(['certificate_generation']);
    expect(metrics.counters).toEqual([
      {
        name: 'task_processed_total',
        labels: { status: 'completed', type: 'certificate_generation' },
      },
    ]);
    expect(metrics.histograms).toEqual([
      {
        name: 'task_processing_duration_seconds',
        value: expect.any(Number) as number,
        labels: { type: 'certificate_generation' },
      },
    ]);
    expect(metrics.histograms[0]?.value).toBeGreaterThan(0);
  });

  it('puts the task back to pending on a transient failure (retry outcome)', async () => {
    simulator = new ScriptedWorkSimulator([{ ok: false, durationMs: 5, reason: 'SMTP timeout' }]);
    await seed(buildTask());

    const result = await useCaseWith(
      TaskProcessorRegistry.withSimulatedProcessors(simulator),
    ).execute({
      taskId: TASK_ID,
    });

    expect(result.success && result.data.outcome).toBe('retry');
    const stored = repository.tasks.get(TASK_ID);
    expect(stored?.status.value).toBe('pending');
    expect(stored?.error).toBe('SMTP timeout');
    expect(stored?.attempts).toBe(1);
    expect(metrics.counters[0]?.labels).toEqual({ status: 'retried', type: 'email_notification' });
  });

  it('fails the task when the last attempt fails too', async () => {
    simulator = new ScriptedWorkSimulator([{ ok: false, durationMs: 5, reason: 'SMTP timeout' }]);
    const twiceTried = must(
      must(must(buildTask().markAsProcessing()).markForRetry('a')).markAsProcessing(),
    );
    await seed(must(twiceTried.markForRetry('b')));

    const result = await useCaseWith(
      TaskProcessorRegistry.withSimulatedProcessors(simulator),
    ).execute({
      taskId: TASK_ID,
    });

    expect(result.success && result.data).toMatchObject({ outcome: 'failed', attempts: 3 });
    expect(repository.tasks.get(TASK_ID)?.error).toBe('SMTP timeout');
  });

  it('fails permanently without retrying when the processor rejects the task', async () => {
    await seed(
      buildTask('email_notification', {
        payload: { to: 'ghost@bounce.test', template: 'welcome', subject: 'Hi' },
      }),
    );

    const result = await useCaseWith(
      TaskProcessorRegistry.withSimulatedProcessors(simulator),
    ).execute({
      taskId: TASK_ID,
    });

    expect(result.success && result.data.outcome).toBe('failed');
    expect(repository.tasks.get(TASK_ID)?.error).toBe(
      'Mailbox ghost@bounce.test does not exist (hard bounce)',
    );
    expect(simulator.calls).toEqual([]);
  });

  it('treats a processor that throws as a transient failure', async () => {
    const crashing: TaskProcessor = {
      type: 'data_sync',
      process: () => Promise.reject(new Error('undefined is not a function')),
    };
    await seed(buildTask('data_sync'));

    const result = await useCaseWith(new TaskProcessorRegistry([crashing])).execute({
      taskId: TASK_ID,
    });

    expect(result.success && result.data.outcome).toBe('retry');
    expect(repository.tasks.get(TASK_ID)?.error).toBe('undefined is not a function');
  });

  it('fails the task when no processor handles its type', async () => {
    await seed(buildTask('data_sync'));

    const result = await useCaseWith(new TaskProcessorRegistry([])).execute({ taskId: TASK_ID });

    expect(result.success && result.data.outcome).toBe('failed');
    expect(repository.tasks.get(TASK_ID)?.error).toBe('No processor for task type data_sync');
  });

  it('skips a task that is already finished (duplicate delivery is idempotent)', async () => {
    await seed(must(must(buildTask().markAsProcessing()).markAsCompleted('done', new Date())));

    const result = await useCaseWith(
      TaskProcessorRegistry.withSimulatedProcessors(simulator),
    ).execute({
      taskId: TASK_ID,
    });

    expect(result.success && result.data).toMatchObject({
      outcome: 'skipped',
      status: 'completed',
    });
    expect(repository.history).toHaveLength(0);
    expect(simulator.calls).toHaveLength(0);
    expect(metrics.counters).toHaveLength(0);
  });

  it('gives up on a task redelivered after crashing the worker too many times', async () => {
    let task = buildTask();
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      task = must(task.markAsProcessing());
    }
    await seed(task);

    const result = await useCaseWith(
      TaskProcessorRegistry.withSimulatedProcessors(simulator),
    ).execute({
      taskId: TASK_ID,
    });

    expect(result.success && result.data.outcome).toBe('failed');
    expect(repository.tasks.get(TASK_ID)?.error).toBe('Gave up after 3 attempts');
    expect(simulator.calls).toHaveLength(0);
  });

  it('returns TaskNotFoundError for an unknown id (the message is dead-lettered)', async () => {
    const result = await useCaseWith(
      TaskProcessorRegistry.withSimulatedProcessors(simulator),
    ).execute({
      taskId: TASK_ID,
    });

    expect(!result.success && result.error).toBeInstanceOf(TaskNotFoundError);
  });

  it('returns UnexpectedError when the database fails (the message is requeued)', async () => {
    await seed(buildTask());
    repository.failUpdatesWith = new Error('Connection lost: The server closed the connection.');

    const result = await useCaseWith(
      TaskProcessorRegistry.withSimulatedProcessors(simulator),
    ).execute({
      taskId: TASK_ID,
    });

    expect(!result.success && result.error).toBeInstanceOf(UnexpectedError);
    expect(simulator.calls).toHaveLength(0);
  });

  it('keeps the error typed when a processor returns a failure result', async () => {
    const failing: TaskProcessor = {
      type: 'data_sync',
      process: () => Promise.resolve(fail(new TaskProcessingError('bad data', false))),
    };
    await seed(buildTask('data_sync'));

    const result = await useCaseWith(new TaskProcessorRegistry([failing])).execute({
      taskId: TASK_ID,
    });

    expect(result.success && result.data.outcome).toBe('failed');
  });
});
