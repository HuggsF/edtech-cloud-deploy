import type { DomainError } from '@domain/errors/domain.error';
import { InvalidTaskError } from '@domain/errors/invalid-task.error';
import type { InvalidTaskPayloadError } from '@domain/errors/invalid-task-payload.error';
import { InvalidTaskTransitionError } from '@domain/errors/invalid-task-transition.error';
import type { InvalidTaskTypeError } from '@domain/errors/invalid-task-type.error';
import { fail, ok } from '@domain/shared/result';
import type { Result } from '@domain/shared/result';
import { TaskPayload } from '@domain/value-objects/task-payload.value-object';
import { TaskStatus } from '@domain/value-objects/task-status.value-object';
import { TaskType } from '@domain/value-objects/task-type.value-object';

/** Outcome texts are bounded so a runaway processor cannot bloat the row (TEXT = 64 KB). */
export const MAX_OUTCOME_LENGTH = 2000;
export const MAX_TASK_ID_LENGTH = 36;

export type CreateTaskProps = {
  readonly id: string;
  readonly type: string;
  readonly payload: unknown;
  readonly createdAt: Date;
};

/** Persisted state, as read back from the repository. */
export type TaskSnapshot = CreateTaskProps & {
  readonly status: string;
  readonly attempts: number;
  readonly result: string | null;
  readonly error: string | null;
  readonly processedAt: Date | null;
};

type TaskState = {
  readonly id: string;
  readonly type: TaskType;
  readonly payload: TaskPayload;
  readonly status: TaskStatus;
  readonly attempts: number;
  readonly result: string | null;
  readonly error: string | null;
  readonly createdAt: Date;
  readonly processedAt: Date | null;
};

export type CreateTaskError = InvalidTaskError | InvalidTaskTypeError | InvalidTaskPayloadError;

const isValidDate = (value: Date): boolean => !Number.isNaN(value.getTime());

const bounded = (text: string): string => {
  const trimmed = text.trim();
  return trimmed.length > MAX_OUTCOME_LENGTH
    ? `${trimmed.slice(0, MAX_OUTCOME_LENGTH - 1)}…`
    : trimmed;
};

/**
 * A unit of educational background work (send an email, generate a report or certificate,
 * synchronise data). Immutable: every transition returns a new Task, and illegal transitions
 * are returned as errors instead of being thrown.
 *
 * pending → processing → completed | failed   (plus retries: processing → pending)
 */
export class Task {
  readonly id: string;
  readonly type: TaskType;
  readonly payload: TaskPayload;
  readonly status: TaskStatus;
  readonly attempts: number;
  readonly result: string | null;
  readonly error: string | null;
  readonly createdAt: Date;
  readonly processedAt: Date | null;

  private constructor(state: TaskState) {
    this.id = state.id;
    this.type = state.type;
    this.payload = state.payload;
    this.status = state.status;
    this.attempts = state.attempts;
    this.result = state.result;
    this.error = state.error;
    this.createdAt = state.createdAt;
    this.processedAt = state.processedAt;
    Object.freeze(this);
  }

  /** A brand-new task, waiting in the queue. */
  static create(props: CreateTaskProps): Result<Task, CreateTaskError> {
    const id = props.id.trim();
    if (id.length === 0 || id.length > MAX_TASK_ID_LENGTH) {
      return fail(new InvalidTaskError(`Task id must be 1 to ${MAX_TASK_ID_LENGTH} characters`));
    }
    if (!isValidDate(props.createdAt)) {
      return fail(new InvalidTaskError('Task creation date is invalid'));
    }
    const type = TaskType.create(props.type);
    if (!type.success) {
      return type;
    }
    const payload = TaskPayload.create(type.data, props.payload);
    if (!payload.success) {
      return payload;
    }
    return ok(
      new Task({
        id,
        type: type.data,
        payload: payload.data,
        status: TaskStatus.PENDING,
        attempts: 0,
        result: null,
        error: null,
        createdAt: props.createdAt,
        processedAt: null,
      }),
    );
  }

  /** Rehydrates a persisted task; corrupted rows are reported instead of silently accepted. */
  static restore(snapshot: TaskSnapshot): Result<Task, DomainError> {
    const created = Task.create(snapshot);
    if (!created.success) {
      return created;
    }
    const status = TaskStatus.create(snapshot.status);
    if (!status.success) {
      return status;
    }
    if (!Number.isInteger(snapshot.attempts) || snapshot.attempts < 0) {
      return fail(new InvalidTaskError('Task attempts must be a non-negative integer'));
    }
    if (snapshot.processedAt !== null && !isValidDate(snapshot.processedAt)) {
      return fail(new InvalidTaskError('Task processing date is invalid'));
    }
    return ok(
      created.data.with({
        status: status.data,
        attempts: snapshot.attempts,
        result: snapshot.result,
        error: snapshot.error,
        processedAt: snapshot.processedAt,
      }),
    );
  }

  get isTerminal(): boolean {
    return this.status.isTerminal;
  }

  /** A worker picked the task up: one more attempt. */
  markAsProcessing(): Result<Task, InvalidTaskTransitionError> {
    return this.transition(TaskStatus.PROCESSING, () =>
      this.with({ status: TaskStatus.PROCESSING, attempts: this.attempts + 1 }),
    );
  }

  markAsCompleted(result: string, at: Date): Result<Task, InvalidTaskTransitionError> {
    return this.transition(TaskStatus.COMPLETED, () =>
      this.with({
        status: TaskStatus.COMPLETED,
        result: bounded(result),
        error: null,
        processedAt: at,
      }),
    );
  }

  markAsFailed(error: string, at: Date): Result<Task, InvalidTaskTransitionError> {
    return this.transition(TaskStatus.FAILED, () =>
      this.with({ status: TaskStatus.FAILED, error: bounded(error), processedAt: at }),
    );
  }

  /** Transient failure: back to the queue, the error of this attempt is kept for visibility. */
  markForRetry(error: string): Result<Task, InvalidTaskTransitionError> {
    return this.transition(TaskStatus.PENDING, () =>
      this.with({ status: TaskStatus.PENDING, error: bounded(error) }),
    );
  }

  hasExhaustedAttempts(maxAttempts: number): boolean {
    return this.attempts >= maxAttempts;
  }

  private transition(
    next: TaskStatus,
    apply: () => Task,
  ): Result<Task, InvalidTaskTransitionError> {
    if (!this.status.canTransitionTo(next)) {
      return fail(new InvalidTaskTransitionError(this.id, this.status.value, next.value));
    }
    return ok(apply());
  }

  private with(changes: Partial<TaskState>): Task {
    return new Task({
      id: this.id,
      type: this.type,
      payload: this.payload,
      status: this.status,
      attempts: this.attempts,
      result: this.result,
      error: this.error,
      createdAt: this.createdAt,
      processedAt: this.processedAt,
      ...changes,
    });
  }
}
