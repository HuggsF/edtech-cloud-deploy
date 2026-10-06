/**
 * Counts the units of work currently running (here: queue messages being processed) so a
 * stopping worker can wait for them before closing its connections.
 */
export class InFlightTracker {
  private active = 0;
  private idleWaiters: (() => void)[] = [];

  get size(): number {
    return this.active;
  }

  /** Runs `work` and keeps it counted until it settles (resolved or rejected). */
  async run<T>(work: () => Promise<T>): Promise<T> {
    this.active += 1;
    try {
      return await work();
    } finally {
      this.active -= 1;
      if (this.active === 0) {
        const waiters = this.idleWaiters;
        this.idleWaiters = [];
        for (const resolve of waiters) {
          resolve();
        }
      }
    }
  }

  /**
   * Resolves `true` as soon as nothing is in flight, or `false` once `timeoutMs` elapsed with
   * work still running (the caller then proceeds anyway: unacked messages are requeued by the
   * broker when the channel closes, so nothing is lost).
   */
  waitForIdle(timeoutMs: number): Promise<boolean> {
    if (this.active === 0) {
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      const onIdle = (): void => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        this.idleWaiters = this.idleWaiters.filter((waiter) => waiter !== onIdle);
        resolve(false);
      }, timeoutMs);
      this.idleWaiters.push(onIdle);
    });
  }
}
