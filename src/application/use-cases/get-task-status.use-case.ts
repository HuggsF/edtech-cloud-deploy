import type { GetTaskStatusInput, TaskOutput } from '@application/dtos/task.dto';
import { TaskNotFoundError } from '@application/errors/task-not-found.error';
import { UnexpectedError } from '@application/errors/unexpected.error';
import { toTaskOutput } from '@application/services/task.mapper';
import type { TaskRepository } from '@domain/repositories/task.repository';
import { fail, ok } from '@domain/shared/result';
import type { Result } from '@domain/shared/result';

/** GET /api/tasks/:id */
export class GetTaskStatusUseCase {
  constructor(private readonly taskRepository: Pick<TaskRepository, 'findById'>) {}

  async execute(
    input: GetTaskStatusInput,
  ): Promise<Result<TaskOutput, TaskNotFoundError | UnexpectedError>> {
    try {
      const task = await this.taskRepository.findById(input.taskId);
      return task === null ? fail(new TaskNotFoundError(input.taskId)) : ok(toTaskOutput(task));
    } catch (error: unknown) {
      return fail(new UnexpectedError('Loading the task', error));
    }
  }
}
