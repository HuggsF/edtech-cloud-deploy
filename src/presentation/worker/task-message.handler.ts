import { setTimeout as sleep } from 'node:timers/promises';
import { TaskNotFoundError } from '@application/errors/task-not-found.error';
import type { Logger } from '@application/interfaces/logger';
import type { ConsumedMessage, MessageBroker } from '@application/interfaces/message-broker';
import type { MetricsExporter } from '@application/interfaces/metrics-exporter';
import { decodeTaskMessage } from '@application/services/task-message.codec';
import type { ProcessTaskUseCase } from '@application/use-cases/process-task.use-case';

export type TaskMessageHandlerOptions = {
  /** Pause before requeueing after an infrastructure failure (e.g. MySQL down). */
  readonly requeueDelayMs: number;
};

export type Delay = (ms: number) => Promise<unknown>;

/**
 * The "controller" of the worker: decodes a message, runs ProcessTaskUseCase and maps the
 * Result to an acknowledgement — exactly like an HTTP controller maps it to a status code.
 *
 * | Result                          | Message action                  |
 * |---------------------------------|---------------------------------|
 * | completed / failed / skipped    | ack (state already persisted)   |
 * | retry (transient failure)       | nack + requeue                  |
 * | malformed message / unknown id  | nack, no requeue → DLQ          |
 * | unexpected (DB down…)           | wait, then nack + requeue       |
 */
export class TaskMessageHandler {
  constructor(
    private readonly processTask: Pick<ProcessTaskUseCase, 'execute'>,
    private readonly broker: Pick<MessageBroker, 'ack' | 'nack'>,
    private readonly metrics: Pick<MetricsExporter, 'exportCounter'>,
    private readonly logger: Logger,
    private readonly options: TaskMessageHandlerOptions,
    private readonly delay: Delay = sleep,
  ) {}

  handle = async (message: ConsumedMessage): Promise<void> => {
    const decoded = decodeTaskMessage(message.content);
    if (!decoded.success) {
      this.deadLetter(message, 'invalid_message', decoded.error.message);
      return;
    }
    const { taskId } = decoded.data;

    const result = await this.processTask.execute({ taskId });
    if (result.success) {
      if (result.data.outcome === 'retry') {
        this.broker.nack(message, true);
      } else {
        this.broker.ack(message);
      }
      return;
    }

    const error = result.error;
    if (error instanceof TaskNotFoundError) {
      this.deadLetter(message, 'task_not_found', error.message);
      return;
    }
    this.logger.error(
      { err: error, taskId, redelivered: message.redelivered },
      'Task processing failed unexpectedly, requeueing',
    );
    await this.delay(this.options.requeueDelayMs);
    this.broker.nack(message, true);
  };

  private deadLetter(message: ConsumedMessage, reason: string, detail: string): void {
    this.logger.warn({ reason, detail }, 'Message dead-lettered');
    this.metrics.exportCounter('messages_dead_lettered_total', { reason });
    this.broker.nack(message, false);
  }
}
