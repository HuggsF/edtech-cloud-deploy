import type { Request, Response } from 'express';
import type { EnqueueTaskUseCase } from '@application/use-cases/enqueue-task.use-case';
import type { GetTaskStatsUseCase } from '@application/use-cases/get-task-stats.use-case';
import type { GetTaskStatusUseCase } from '@application/use-cases/get-task-status.use-case';
import { toHttpError } from '@presentation/http/errors/error-mapper';
import { enqueueTaskBodySchema, taskIdParamsSchema } from '@presentation/http/schemas/task.schemas';
import { validate } from '@presentation/http/schemas/validate';

/** Thin HTTP adapter: validate the request shape, call one use case, map the Result. */
export class TaskController {
  constructor(
    private readonly enqueueTask: Pick<EnqueueTaskUseCase, 'execute'>,
    private readonly getTaskStatus: Pick<GetTaskStatusUseCase, 'execute'>,
    private readonly getTaskStats: Pick<GetTaskStatsUseCase, 'execute'>,
  ) {}

  /** POST /api/tasks → 202 Accepted: the work happens asynchronously in a worker. */
  enqueue = async (request: Request, response: Response): Promise<void> => {
    const body = validate(enqueueTaskBodySchema, request.body);
    const result = await this.enqueueTask.execute(body);
    if (!result.success) {
      throw toHttpError(result.error);
    }
    const statusUrl = `/api/tasks/${result.data.taskId}`;
    response
      .status(202)
      .location(statusUrl)
      .json({ ...result.data, statusUrl });
  };

  /** GET /api/tasks/:id */
  status = async (request: Request, response: Response): Promise<void> => {
    const { id } = validate(taskIdParamsSchema, request.params);
    const result = await this.getTaskStatus.execute({ taskId: id });
    if (!result.success) {
      throw toHttpError(result.error);
    }
    response.status(200).json(result.data);
  };

  /** GET /api/tasks/stats */
  stats = async (_request: Request, response: Response): Promise<void> => {
    const result = await this.getTaskStats.execute();
    if (!result.success) {
      throw toHttpError(result.error);
    }
    response.status(200).json(result.data);
  };
}
