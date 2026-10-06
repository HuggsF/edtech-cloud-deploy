import type { TaskProcessingError } from '@application/errors/task-processing.error';
import type { Task } from '@domain/entities/task.entity';
import type { Result } from '@domain/shared/result';
import type { TaskTypeValue } from '@domain/value-objects/task-type.value-object';

/**
 * Strategy that performs the work of one task type. Returns a short, human-readable result
 * stored with the task, or a TaskProcessingError (retryable or permanent).
 *
 * Processors must be idempotent per task id: with at-least-once delivery a task may run twice.
 */
export interface TaskProcessor {
  readonly type: TaskTypeValue;
  process(task: Task): Promise<Result<string, TaskProcessingError>>;
}
