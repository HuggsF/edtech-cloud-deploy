import type { EnqueueTaskOutput, TaskOutput } from '@application/dtos/task.dto';
import type { Task } from '@domain/entities/task.entity';

/** Domain entities never leave the Application layer: they are mapped to plain DTOs. */
export const toTaskOutput = (task: Task): TaskOutput => ({
  id: task.id,
  type: task.type.value,
  status: task.status.value,
  payload: task.payload.toJSON(),
  attempts: task.attempts,
  result: task.result,
  error: task.error,
  createdAt: task.createdAt.toISOString(),
  processedAt: task.processedAt?.toISOString() ?? null,
});

export const toEnqueueTaskOutput = (task: Task): EnqueueTaskOutput => ({
  taskId: task.id,
  type: task.type.value,
  status: task.status.value,
  createdAt: task.createdAt.toISOString(),
});
