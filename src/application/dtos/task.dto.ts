import type { TaskPayloadData } from '@domain/value-objects/task-payload.value-object';
import type { TaskStatusValue } from '@domain/value-objects/task-status.value-object';
import type { TaskTypeValue } from '@domain/value-objects/task-type.value-object';

export type EnqueueTaskInput = {
  readonly type: string;
  readonly payload: unknown;
};

export type EnqueueTaskOutput = {
  readonly taskId: string;
  readonly type: TaskTypeValue;
  readonly status: TaskStatusValue;
  readonly createdAt: string;
};

export type GetTaskStatusInput = {
  readonly taskId: string;
};

export type TaskOutput = {
  readonly id: string;
  readonly type: TaskTypeValue;
  readonly status: TaskStatusValue;
  readonly payload: TaskPayloadData;
  readonly attempts: number;
  readonly result: string | null;
  readonly error: string | null;
  readonly createdAt: string;
  readonly processedAt: string | null;
};

export type TaskStatsOutput = {
  readonly byStatus: Readonly<Record<TaskStatusValue, number>>;
  readonly total: number;
  readonly queue: {
    readonly name: string;
    /** null when the broker could not be reached: the counts are still useful. */
    readonly depth: number | null;
  };
};

export type ProcessTaskInput = {
  readonly taskId: string;
};

/**
 * - completed / failed: final state persisted → acknowledge the message.
 * - retry: transient failure persisted (task back to pending) → requeue the message.
 * - skipped: the task was already finished (duplicate delivery) → acknowledge.
 */
export type ProcessTaskOutcome = 'completed' | 'failed' | 'retry' | 'skipped';

export type ProcessTaskOutput = {
  readonly taskId: string;
  readonly outcome: ProcessTaskOutcome;
  readonly status: TaskStatusValue;
  readonly attempts: number;
  readonly durationMs: number;
};
