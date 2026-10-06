import { ApplicationError } from './application.error';

/**
 * A processor could not complete a task. `retryable` failures (timeouts, upstream 5xx) are put
 * back in the queue until the attempts are exhausted; permanent ones fail the task at once.
 */
export class TaskProcessingError extends ApplicationError {
  readonly code = 'TASK_PROCESSING_FAILED';

  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}
