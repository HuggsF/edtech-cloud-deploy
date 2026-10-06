import { DomainError } from './domain.error';

export class InvalidTaskTransitionError extends DomainError {
  readonly code = 'INVALID_TASK_TRANSITION';

  constructor(
    readonly taskId: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`Task ${taskId} cannot move from "${from}" to "${to}"`);
  }
}
