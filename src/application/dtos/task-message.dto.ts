import type { TaskTypeValue } from '@domain/value-objects/task-type.value-object';

/**
 * What travels through the queue: only the task reference. The payload lives in MySQL (single
 * source of truth), which keeps messages tiny and lets the worker reject stale/unknown ids.
 */
export type TaskMessage = {
  readonly taskId: string;
  readonly type: TaskTypeValue;
  readonly enqueuedAt: string;
};
