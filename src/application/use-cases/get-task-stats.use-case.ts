import type { TaskStatsOutput } from '@application/dtos/task.dto';
import { UnexpectedError } from '@application/errors/unexpected.error';
import type { Logger } from '@application/interfaces/logger';
import type { MessageBroker } from '@application/interfaces/message-broker';
import type { TaskRepository } from '@domain/repositories/task.repository';
import { fail, ok } from '@domain/shared/result';
import type { Result } from '@domain/shared/result';

export type GetTaskStatsOptions = {
  readonly queue: string;
};

/** GET /api/tasks/stats — task counts by status plus the live queue depth. */
export class GetTaskStatsUseCase {
  constructor(
    private readonly taskRepository: Pick<TaskRepository, 'countByStatus'>,
    private readonly broker: Pick<MessageBroker, 'getQueueDepth'>,
    private readonly logger: Logger,
    private readonly options: GetTaskStatsOptions,
  ) {}

  async execute(): Promise<Result<TaskStatsOutput, UnexpectedError>> {
    const [counts, depth] = await Promise.allSettled([
      this.taskRepository.countByStatus(),
      this.broker.getQueueDepth(this.options.queue),
    ]);
    if (counts.status === 'rejected') {
      return fail(new UnexpectedError('Counting tasks by status', counts.reason));
    }
    if (depth.status === 'rejected') {
      this.logger.warn({ err: depth.reason }, 'Queue depth unavailable');
    }
    const byStatus = counts.value;
    return ok({
      byStatus: { ...byStatus },
      total: byStatus.pending + byStatus.processing + byStatus.completed + byStatus.failed,
      queue: {
        name: this.options.queue,
        depth: depth.status === 'fulfilled' ? depth.value : null,
      },
    });
  }
}
