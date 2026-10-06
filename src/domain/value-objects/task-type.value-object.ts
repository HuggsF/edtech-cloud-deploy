import { InvalidTaskTypeError } from '@domain/errors/invalid-task-type.error';
import { fail, ok } from '@domain/shared/result';
import type { Result } from '@domain/shared/result';

export const TASK_TYPES = [
  'email_notification',
  'report_generation',
  'data_sync',
  'certificate_generation',
] as const;

export type TaskTypeValue = (typeof TASK_TYPES)[number];

const isTaskTypeValue = (value: string): value is TaskTypeValue =>
  (TASK_TYPES as readonly string[]).includes(value);

/** The kind of educational work a task represents. Each type has its own payload schema. */
export class TaskType {
  private constructor(readonly value: TaskTypeValue) {}

  static create(raw: string): Result<TaskType, InvalidTaskTypeError> {
    const value = raw.trim();
    if (!isTaskTypeValue(value)) {
      return fail(new InvalidTaskTypeError(raw, TASK_TYPES));
    }
    return ok(new TaskType(value));
  }

  /** Typed constructor for values the compiler already knows are valid. */
  static of(value: TaskTypeValue): TaskType {
    return new TaskType(value);
  }

  equals(other: TaskType): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
