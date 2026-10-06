import { ApplicationError } from './application.error';

/** The task was stored but the broker did not confirm the message: the task is marked failed. */
export class TaskEnqueueFailedError extends ApplicationError {
  readonly code = 'TASK_ENQUEUE_FAILED';

  constructor(
    readonly taskId: string,
    cause: unknown,
  ) {
    super(`Task ${taskId} could not be published to the queue`, { cause });
  }
}
