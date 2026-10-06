import { DomainError } from './domain.error';

/** Every violation of the type-specific payload schema, collected in one error. */
export class InvalidTaskPayloadError extends DomainError {
  readonly code = 'INVALID_TASK_PAYLOAD';

  constructor(
    readonly taskType: string,
    readonly issues: readonly string[],
  ) {
    super(`Invalid payload for task type "${taskType}": ${issues.join('; ')}`);
  }
}
