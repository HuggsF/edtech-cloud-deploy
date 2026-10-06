import { InFlightTracker } from '@infrastructure/lifecycle/in-flight-tracker';

type Deferred = { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void };

const deferred = (): Deferred => {
  let resolve: () => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('InFlightTracker', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('counts work while it runs and returns its result', async () => {
    const tracker = new InFlightTracker();
    const first = deferred();
    const second = deferred();

    const runs = [
      tracker.run(() => first.promise),
      tracker.run(() => second.promise.then(() => 42)),
    ];
    expect(tracker.size).toBe(2);

    first.resolve();
    await runs[0];
    expect(tracker.size).toBe(1);
    second.resolve();
    await expect(runs[1]).resolves.toBe(42);
    expect(tracker.size).toBe(0);
  });

  it('releases the slot when the work fails and propagates the error', async () => {
    const tracker = new InFlightTracker();

    await expect(tracker.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(tracker.size).toBe(0);
  });

  it('resolves waitForIdle immediately when idle', async () => {
    await expect(new InFlightTracker().waitForIdle(1000)).resolves.toBe(true);
  });

  it('resolves waitForIdle(true) as soon as the last work finishes', async () => {
    const tracker = new InFlightTracker();
    const work = deferred();
    const run = tracker.run(() => work.promise);

    const idle = tracker.waitForIdle(30_000);
    const otherWaiter = tracker.waitForIdle(30_000);
    work.resolve();
    await run;

    await expect(idle).resolves.toBe(true);
    await expect(otherWaiter).resolves.toBe(true);
  });

  it('resolves waitForIdle(false) when the timeout elapses first', async () => {
    jest.useFakeTimers();
    const tracker = new InFlightTracker();
    const work = deferred();
    const run = tracker.run(() => work.promise);

    const idle = tracker.waitForIdle(30_000);
    jest.advanceTimersByTime(30_000);

    await expect(idle).resolves.toBe(false);
    expect(tracker.size).toBe(1);
    // A late completion does not resolve the expired waiter twice nor throw.
    work.resolve();
    await run;
    expect(tracker.size).toBe(0);
  });
});
