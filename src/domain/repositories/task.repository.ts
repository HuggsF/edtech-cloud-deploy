import type { Task } from '@domain/entities/task.entity';
import type { TaskStatusValue } from '@domain/value-objects/task-status.value-object';

export type TaskCountByStatus = Readonly<Record<TaskStatusValue, number>>;

/** Persistence port for tasks (implemented with MySQL in the Infrastructure layer). */
export interface TaskRepository {
  /** Inserts a new task. */
  save(task: Task): Promise<void>;
  findById(id: string): Promise<Task | null>;
  /**
   * Persists the lifecycle fields of a task after a transition (status, attempts, result,
   * error, processed_at). Rejects when the task does not exist.
   */
  updateStatus(task: Task): Promise<void>;
  /** Every status is present in the result, with 0 when no task has it. */
  countByStatus(): Promise<TaskCountByStatus>;
}
