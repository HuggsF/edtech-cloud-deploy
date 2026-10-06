import { DomainError } from './domain.error';

/** A task property outside its invariants (empty id, negative attempts, invalid date…). */
export class InvalidTaskError extends DomainError {
  readonly code = 'INVALID_TASK';

  constructor(readonly reason: string) {
    super(reason);
  }
}
