import type { EnqueueTaskInput, EnqueueTaskOutput } from '@application/dtos/task.dto';
import { TaskEnqueueFailedError } from '@application/errors/task-enqueue-failed.error';
import { UnexpectedError } from '@application/errors/unexpected.error';
import type { Clock } from '@application/interfaces/clock';
import type { IdGenerator } from '@application/interfaces/id-generator';
import type { Logger } from '@application/interfaces/logger';
import type { MessageBroker } from '@application/interfaces/message-broker';
import type { MetricsExporter } from '@application/interfaces/metrics-exporter';
import { toEnqueueTaskOutput } from '@application/services/task.mapper';
import { encodeTaskMessage } from '@application/services/task-message.codec';
import { Task } from '@domain/entities/task.entity';
import type { CreateTaskError } from '@domain/entities/task.entity';
import type { TaskRepository } from '@domain/repositories/task.repository';
import { fail, ok } from '@domain/shared/result';
import type { Result } from '@domain/shared/result';

export type EnqueueTaskError = CreateTaskError | TaskEnqueueFailedError | UnexpectedError;

export type EnqueueTaskOptions = {
  readonly queue: string;
};

/**
 * POST /api/tasks. The task is validated by the Domain, stored as `pending`, then its id is
 * published with a publisher confirm. Storing first means a worker can never receive an id
 * that is not in the database; if the publish fails the task is marked `failed` so it does not
 * stay pending forever (a transactional outbox would remove that window entirely).
 */
export class EnqueueTaskUseCase {
  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly broker: Pick<MessageBroker, 'publish'>,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock,
    private readonly metrics: Pick<MetricsExporter, 'exportCounter'>,
    private readonly logger: Logger,
    private readonly options: EnqueueTaskOptions,
  ) {}

  async execute(input: EnqueueTaskInput): Promise<Result<EnqueueTaskOutput, EnqueueTaskError>> {
    const created = Task.create({
      id: this.idGenerator.generate(),
      type: input.type,
      payload: input.payload,
      createdAt: this.clock.now(),
    });
    if (!created.success) {
      return created;
    }
    const task = created.data;

    try {
      await this.taskRepository.save(task);
    } catch (error: unknown) {
      return fail(new UnexpectedError('Saving the task', error));
    }

    try {
      await this.broker.publish(
        this.options.queue,
        encodeTaskMessage({
          taskId: task.id,
          type: task.type.value,
          enqueuedAt: task.createdAt.toISOString(),
        }),
      );
    } catch (error: unknown) {
      this.logger.error({ err: error, taskId: task.id }, 'Task could not be published');
      await this.markAsNotEnqueued(task);
      return fail(new TaskEnqueueFailedError(task.id, error));
    }

    this.metrics.exportCounter('task_enqueued_total', { type: task.type.value });
    this.logger.info({ taskId: task.id, type: task.type.value }, 'Task enqueued');
    return ok(toEnqueueTaskOutput(task));
  }

  private async markAsNotEnqueued(task: Task): Promise<void> {
    const failed = task.markAsFailed('Task could not be published to the queue', this.clock.now());
    if (!failed.success) {
      return;
    }
    try {
      await this.taskRepository.updateStatus(failed.data);
    } catch (error: unknown) {
      this.logger.error({ err: error, taskId: task.id }, 'Could not mark the task as failed');
    }
  }
}
