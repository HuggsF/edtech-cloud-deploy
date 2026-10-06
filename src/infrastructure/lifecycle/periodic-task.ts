import type { Logger } from '@application/interfaces/logger';

export type PeriodicTaskOptions = {
  readonly name: string;
  readonly intervalMs: number;
  readonly run: () => Promise<void>;
  readonly logger: Logger;
};

/**
 * Runs `run` immediately, then every `intervalMs`, never overlapping two runs (a slow broker
 * cannot pile up concurrent samples). Timers are unref'd: they never keep the process alive.
 */
export class PeriodicTask {
  private timer: NodeJS.Timeout | null = null;
  private current: Promise<void> | null = null;
  private stopped = true;

  constructor(private readonly options: PeriodicTaskOptions) {}

  start(): void {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.tick();
  }

  /** Stops scheduling and waits for the run in progress, if any. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.current;
  }

  private tick(): void {
    this.current = this.options
      .run()
      .catch((error: unknown) => {
        this.options.logger.warn({ err: error, task: this.options.name }, 'Periodic task failed');
      })
      .finally(() => {
        this.current = null;
        if (!this.stopped) {
          this.timer = setTimeout(() => {
            this.tick();
          }, this.options.intervalMs);
          this.timer.unref();
        }
      });
  }
}
