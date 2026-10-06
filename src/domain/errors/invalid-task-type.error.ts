import { DomainError } from './domain.error';

export class InvalidTaskTypeError extends DomainError {
  readonly code = 'INVALID_TASK_TYPE';

  constructor(
    readonly value: string,
    readonly allowed: readonly string[],
  ) {
    super(`Unknown task type "${value}". Allowed types: ${allowed.join(', ')}`);
  }
}
