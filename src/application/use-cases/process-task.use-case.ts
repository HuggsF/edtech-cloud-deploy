import type {
  ProcessTaskInput,
  ProcessTaskOutcome,
  ProcessTaskOutput,
} from '@application/dtos/task.dto';
import { errorMessage } from '@application/errors/error-message';
import { TaskNotFoundError } from '@application/errors/task-not-found.error';
import { TaskProcessingError } from '@application/errors/task-processing.error';
import { UnexpectedError } from '@application/errors/unexpected.error';
import type { Clock } from '@application/interfaces/clock';
import type { Logger } from '@application/interfaces/logger';
import type { MetricsExporter } from '@application/interfaces/metrics-exporter';
import type { TaskProcessorRegistry } from '@application/services/processors/task-processor.registry';
import type { Task } from '@domain/entities/task.entity';
import type { InvalidTaskTransitionError } from '@domain/errors/invalid-task-transition.error';
import type { TaskRepository } from '@domain/repositories/task.repository';
import { fail, ok } from '@domain/shared/result';
import type { Result } from '@domain/shared/result';

export type ProcessTaskError = TaskNotFoundError | InvalidTaskTransitionError | UnexpectedError;

export type ProcessTaskOptions = {
  /** Deliveries of the same task before it is failed for good (crash loops, transient errors). */
  readonly maxAttempts: number;
};

/**
 * Runs one task taken from the queue. The returned outcome tells the consumer what to do with
 * the message — and every outcome is persisted BEFORE it is returned, so the message is only
 * acknowledged once the task status is durable in MySQL (at-least-once processing).
 */
export class ProcessTaskUseCase {
  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly processors: TaskProcessorRegistry,
    private readonly clock: Clock,
    private readonly metrics: Pick<MetricsExporter, 'exportCounter' | 'exportHistogram'>,
    private readonly logger: Logger,
    private readonly options: ProcessTaskOptions,
  ) {}

  async execute(input: ProcessTaskInput): Promise<Result<ProcessTaskOutput, ProcessTaskError>> {
    const startedAt = this.clock.now().getTime();
    try {
      const task = await this.taskRepository.findById(input.taskId);
      if (task === null) {
        return fail(new TaskNotFoundError(input.taskId));
      }
      if (task.isTerminal) {
        this.logger.info(
          { taskId: task.id, status: task.status.value },
          'Duplicate delivery skipped',
        );
        return ok(this.output(task, 'skipped', startedAt));
      }
      if (task.hasExhaustedAttempts(this.options.maxAttempts)) {
        return await this.finish(
          task,
          task.markAsFailed(`Gave up after ${task.attempts} attempts`, this.clock.now()),
          startedAt,
        );
      }

      const started = task.markAsProcessing();
      if (!started.success) {
        return started;
      }
      await this.taskRepository.updateStatus(started.data);
      return await this.run(started.data, startedAt);
    } catch (error: unknown) {
      return fail(new UnexpectedError(`Processing task ${input.taskId}`, error));
    }
  }

  private async run(
    task: Task,
    startedAt: number,
  ): Promise<Result<ProcessTaskOutput, ProcessTaskError>> {
    const processor = this.processors.forType(task.type);
    if (processor === null) {
      const failed = task.markAsFailed(
        `No processor for task type ${task.type.value}`,
        this.clock.now(),
      );
      return this.finish(task, failed, startedAt);
    }

    let outcome: Result<string, TaskProcessingError>;
    try {
      outcome = await processor.process(task);
    } catch (error: unknown) {
      // A bug in a processor must not kill the worker: treat it as a transient failure.
      outcome = fail(new TaskProcessingError(errorMessage(error), true));
    }

    if (outcome.success) {
      return this.finish(task, task.markAsCompleted(outcome.data, this.clock.now()), startedAt);
    }
    const { message, retryable } = outcome.error;
    if (retryable && !task.hasExhaustedAttempts(this.options.maxAttempts)) {
      this.logger.warn(
        { taskId: task.id, attempts: task.attempts, reason: message },
        'Task will be retried',
      );
      return this.finish(task, task.markForRetry(message), startedAt);
    }
    return this.finish(task, task.markAsFailed(message, this.clock.now()), startedAt);
  }

  private async finish(
    task: Task,
    transition: Result<Task, InvalidTaskTransitionError>,
    startedAt: number,
  ): Promise<Result<ProcessTaskOutput, ProcessTaskError>> {
    if (!transition.success) {
      return transition;
    }
    const next = transition.data;
    await this.taskRepository.updateStatus(next);

    const outcome: ProcessTaskOutcome =
      next.status.value === 'pending'
        ? 'retry'
        : next.status.value === 'completed'
          ? 'completed'
          : 'failed';
    const output = this.output(next, outcome, startedAt);
    const status = outcome === 'retry' ? 'retried' : outcome;
    this.metrics.exportCounter('task_processed_total', { status, type: task.type.value });
    this.metrics.exportHistogram('task_processing_duration_seconds', output.durationMs / 1000, {
      type: task.type.value,
    });
    this.logger.info(
      {
        taskId: next.id,
        type: next.type.value,
        outcome,
        attempts: next.attempts,
        durationMs: output.durationMs,
      },
      'Task processed',
    );
    return ok(output);
  }

  private output(task: Task, outcome: ProcessTaskOutcome, startedAt: number): ProcessTaskOutput {
    return {
      taskId: task.id,
      outcome,
      status: task.status.value,
      attempts: task.attempts,
      durationMs: Math.max(0, this.clock.now().getTime() - startedAt),
    };
  }
}
