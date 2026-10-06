import { InvalidTaskStatusError } from '@domain/errors/invalid-task-status.error';
import { fail, ok } from '@domain/shared/result';
import type { Result } from '@domain/shared/result';

export const TASK_STATUSES = ['pending', 'processing', 'completed', 'failed'] as const;

export type TaskStatusValue = (typeof TASK_STATUSES)[number];

/**
 * Allowed lifecycle transitions.
 *
 * - pending → processing: a worker picked the message up.
 * - pending → failed: the task could not be published to the queue.
 * - processing → processing: the message was redelivered after a worker crashed mid-task
 *   (at-least-once delivery), so the task is picked up again with one more attempt.
 * - processing → pending: a transient failure; the message goes back to the queue for a retry.
 * - processing → completed | failed: final outcome.
 */
const TRANSITIONS: Readonly<Record<TaskStatusValue, readonly TaskStatusValue[]>> = {
  pending: ['processing', 'failed'],
  processing: ['processing', 'pending', 'completed', 'failed'],
  completed: [],
  failed: [],
};

const isTaskStatusValue = (value: string): value is TaskStatusValue =>
  (TASK_STATUSES as readonly string[]).includes(value);

export class TaskStatus {
  static readonly PENDING = new TaskStatus('pending');
  static readonly PROCESSING = new TaskStatus('processing');
  static readonly COMPLETED = new TaskStatus('completed');
  static readonly FAILED = new TaskStatus('failed');

  private constructor(readonly value: TaskStatusValue) {}

  static create(raw: string): Result<TaskStatus, InvalidTaskStatusError> {
    return isTaskStatusValue(raw) ? ok(TaskStatus.of(raw)) : fail(new InvalidTaskStatusError(raw));
  }

  static of(value: TaskStatusValue): TaskStatus {
    switch (value) {
      case 'pending':
        return TaskStatus.PENDING;
      case 'processing':
        return TaskStatus.PROCESSING;
      case 'completed':
        return TaskStatus.COMPLETED;
      case 'failed':
        return TaskStatus.FAILED;
    }
  }

  /** completed and failed are final: a duplicate delivery of a finished task is a no-op. */
  get isTerminal(): boolean {
    return TRANSITIONS[this.value].length === 0;
  }

  canTransitionTo(next: TaskStatus): boolean {
    return TRANSITIONS[this.value].includes(next.value);
  }

  equals(other: TaskStatus): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
