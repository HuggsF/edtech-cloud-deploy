import { TaskProcessingError } from '@application/errors/task-processing.error';
import type { TaskProcessor } from '@application/interfaces/task-processor';
import type { WorkSimulator } from '@application/interfaces/work-simulator';
import type { Task } from '@domain/entities/task.entity';
import { fail, ok } from '@domain/shared/result';
import type { Result } from '@domain/shared/result';
import type { TaskTypeValue } from '@domain/value-objects/task-type.value-object';

/**
 * Template method shared by every processor: business pre-checks (permanent failures), then
 * the (simulated) slow I/O, then a deterministic result text derived from the payload.
 */
export abstract class SimulatedTaskProcessor implements TaskProcessor {
  abstract readonly type: TaskTypeValue;

  constructor(private readonly simulator: WorkSimulator) {}

  async process(task: Task): Promise<Result<string, TaskProcessingError>> {
    const rejection = this.rejectionReason(task);
    if (rejection !== null) {
      return fail(new TaskProcessingError(rejection, false));
    }
    const outcome = await this.simulator.perform(this.type);
    if (!outcome.ok) {
      return fail(new TaskProcessingError(outcome.reason, true));
    }
    return ok(this.describe(task));
  }

  /** A reason that makes the task impossible to complete (never retried), or null. */
  protected rejectionReason(_task: Task): string | null {
    return null;
  }

  protected abstract describe(task: Task): string;
}

/** Short, stable reference derived from the task id (e.g. certificate numbers). */
export const shortReference = (taskId: string): string =>
  taskId.replace(/-/g, '').slice(-10).toUpperCase();
