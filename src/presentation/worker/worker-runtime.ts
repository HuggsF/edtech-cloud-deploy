import { performance } from 'node:perf_hooks';
import type { Logger } from '@application/interfaces/logger';
import type { MessageBroker } from '@application/interfaces/message-broker';
import type { InFlightTracker } from '@infrastructure/lifecycle/in-flight-tracker';
import type { TaskMessageHandler } from './task-message.handler';

export type WorkerRuntimeOptions = {
  readonly queue: string;
  /** Upper bound to wait for in-flight messages on shutdown (SPEC: 30 s). */
  readonly drainTimeoutMs: number;
};

export type DrainReport = {
  readonly inFlightAtStop: number;
  readonly drained: boolean;
  readonly waitedMs: number;
};

/**
 * Lifecycle of a stateless queue consumer. Everything a worker knows lives in RabbitMQ or
 * MySQL, so any replica can be stopped at any time — provided it stops like this:
 *
 * 1. stop consuming (basic.cancel): the broker sends no new messages to this replica;
 * 2. wait for the in-flight messages (bounded): each one is persisted and acked;
 * 3. the caller then closes the channel/connection — anything still unacked is requeued by the
 *    broker and processed by another replica — and the database pool.
 */
export class WorkerRuntime {
  private accepting = false;

  constructor(
    private readonly broker: Pick<MessageBroker, 'consume' | 'stopConsuming'>,
    private readonly handler: TaskMessageHandler,
    private readonly inFlight: InFlightTracker,
    private readonly logger: Logger,
    private readonly options: WorkerRuntimeOptions,
  ) {}

  get isAcceptingWork(): boolean {
    return this.accepting;
  }

  async start(): Promise<void> {
    await this.broker.consume(this.options.queue, (message) =>
      this.inFlight.run(() => this.handler.handle(message)),
    );
    this.accepting = true;
  }

  async stop(): Promise<DrainReport> {
    this.accepting = false;
    const startedAt = performance.now();
    await this.broker.stopConsuming();
    const inFlightAtStop = this.inFlight.size;
    this.logger.info(
      { inFlight: inFlightAtStop, drainTimeoutMs: this.options.drainTimeoutMs },
      'Stopped consuming, waiting for in-flight messages',
    );
    const drained = await this.inFlight.waitForIdle(this.options.drainTimeoutMs);
    const report: DrainReport = {
      inFlightAtStop,
      drained,
      waitedMs: Math.round(performance.now() - startedAt),
    };
    if (drained) {
      this.logger.info(report, 'In-flight messages drained');
    } else {
      this.logger.warn(
        { ...report, stillInFlight: this.inFlight.size },
        'Drain timeout reached: unacknowledged messages will be redelivered to another worker',
      );
    }
    return report;
  }
}
