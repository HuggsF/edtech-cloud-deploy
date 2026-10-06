import { ApplicationError } from './application.error';

export class TaskNotFoundError extends ApplicationError {
  readonly code = 'TASK_NOT_FOUND';

  constructor(readonly taskId: string) {
    super(`Task ${taskId} was not found`);
  }
}
