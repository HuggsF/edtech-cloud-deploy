import { ApplicationError } from './application.error';

/** A queue message that can never be processed (poison message): it goes to the DLQ. */
export class InvalidTaskMessageError extends ApplicationError {
  readonly code = 'INVALID_TASK_MESSAGE';

  constructor(reason: string) {
    super(`Invalid task message: ${reason}`);
  }
}
