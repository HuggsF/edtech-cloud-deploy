import { ApplicationError } from './application.error';
import { errorMessage } from './error-message';

/** Wraps an unanticipated infrastructure exception so use cases can still return a Result. */
export class UnexpectedError extends ApplicationError {
  readonly code = 'UNEXPECTED_ERROR';

  constructor(operation: string, cause: unknown) {
    super(`${operation} failed unexpectedly: ${errorMessage(cause)}`, { cause });
  }
}
