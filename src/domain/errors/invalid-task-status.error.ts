import { DomainError } from './domain.error';

export class InvalidTaskStatusError extends DomainError {
  readonly code = 'INVALID_TASK_STATUS';

  constructor(readonly value: string) {
    super(`Unknown task status "${value}"`);
  }
}
