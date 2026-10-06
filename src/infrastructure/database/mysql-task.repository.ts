import type { Knex } from 'knex';
import { Task } from '@domain/entities/task.entity';
import type { TaskCountByStatus, TaskRepository } from '@domain/repositories/task.repository';
import { TASK_STATUSES } from '@domain/value-objects/task-status.value-object';
import type { TaskStatusValue } from '@domain/value-objects/task-status.value-object';

export const TASKS_TABLE = 'tasks';

export type TaskRow = {
  id: string;
  type: string;
  payload: unknown;
  status: string;
  attempts: number;
  result: string | null;
  error: string | null;
  created_at: Date;
  processed_at: Date | null;
};

/**
 * The schema uses TIMESTAMP (second precision). MySQL ROUNDS fractional seconds on insert, so
 * dates are truncated here instead: a task can never appear to be created in the future.
 */
const toSeconds = (date: Date): Date => new Date(Math.floor(date.getTime() / 1000) * 1000);

/** mysql2 returns JSON columns already parsed; some proxies return them as strings. */
const parsePayload = (payload: unknown): unknown =>
  typeof payload === 'string' ? (JSON.parse(payload) as unknown) : payload;

const toEntity = (row: TaskRow): Task => {
  const restored = Task.restore({
    id: row.id,
    type: row.type,
    payload: parsePayload(row.payload),
    status: row.status,
    attempts: row.attempts,
    result: row.result,
    error: row.error,
    createdAt: new Date(row.created_at),
    processedAt: row.processed_at === null ? null : new Date(row.processed_at),
  });
  if (!restored.success) {
    throw new Error(`Corrupted task row ${row.id}: ${restored.error.message}`);
  }
  return restored.data;
};

const lifecycleColumns = (
  task: Task,
): Pick<TaskRow, 'status' | 'attempts' | 'result' | 'error' | 'processed_at'> => ({
  status: task.status.value,
  attempts: task.attempts,
  result: task.result,
  error: task.error,
  processed_at: task.processedAt === null ? null : toSeconds(task.processedAt),
});

export class MySqlTaskRepository implements TaskRepository {
  constructor(private readonly db: Knex) {}

  async save(task: Task): Promise<void> {
    await this.db<TaskRow>(TASKS_TABLE).insert({
      id: task.id,
      type: task.type.value,
      payload: JSON.stringify(task.payload.toJSON()),
      created_at: toSeconds(task.createdAt),
      ...lifecycleColumns(task),
    });
  }

  async findById(id: string): Promise<Task | null> {
    const row = await this.db<TaskRow>(TASKS_TABLE).where({ id }).first();
    return row === undefined ? null : toEntity(row);
  }

  async updateStatus(task: Task): Promise<void> {
    const updated = await this.db<TaskRow>(TASKS_TABLE)
      .where({ id: task.id })
      .update(lifecycleColumns(task));
    if (updated === 0) {
      throw new Error(`Task ${task.id} does not exist`);
    }
  }

  async countByStatus(): Promise<TaskCountByStatus> {
    const rows = await this.db(TASKS_TABLE)
      .select('status')
      .count<{ status: TaskStatusValue; total: number | string }[]>({ total: '*' })
      .groupBy('status');
    const counts = Object.fromEntries(TASK_STATUSES.map((status) => [status, 0])) as Record<
      TaskStatusValue,
      number
    >;
    for (const row of rows) {
      counts[row.status] = Number(row.total);
    }
    return counts;
  }
}
