import { PeriodicTask } from '@infrastructure/lifecycle/periodic-task';
import { createLoggerMock } from '../../support/fakes';

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
};

describe('PeriodicTask', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('runs immediately, then every interval, until stopped', async () => {
    const run = jest.fn().mockResolvedValue(undefined);
    const task = new PeriodicTask({
      name: 'sample',
      intervalMs: 1000,
      run,
      logger: createLoggerMock(),
    });

    task.start();
    task.start(); // idempotent
    await flush();
    expect(run).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1000);
    await flush();
    expect(run).toHaveBeenCalledTimes(2);

    await task.stop();
    jest.advanceTimersByTime(5000);
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('never overlaps runs: the next one is scheduled after the previous finishes', async () => {
    let release: () => void = () => undefined;
    const run = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const task = new PeriodicTask({
      name: 'slow',
      intervalMs: 100,
      run,
      logger: createLoggerMock(),
    });

    task.start();
    jest.advanceTimersByTime(1000);
    await flush();
    expect(run).toHaveBeenCalledTimes(1);

    release();
    await flush();
    jest.advanceTimersByTime(100);
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
    release();
    await task.stop();
  });

  it('logs failures and keeps running', async () => {
    const logger = createLoggerMock();
    const run = jest
      .fn()
      .mockRejectedValueOnce(new Error('broker down'))
      .mockResolvedValue(undefined);
    const task = new PeriodicTask({ name: 'sample', intervalMs: 50, run, logger });

    task.start();
    await flush();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ task: 'sample' }),
      'Periodic task failed',
    );
    jest.advanceTimersByTime(50);
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
    await task.stop();
  });

  it('stop() waits for the run in progress', async () => {
    let release: () => void = () => undefined;
    let finished = false;
    const run = (): Promise<void> =>
      new Promise<void>((resolve) => {
        release = () => {
          finished = true;
          resolve();
        };
      });
    const task = new PeriodicTask({
      name: 'slow',
      intervalMs: 10,
      run,
      logger: createLoggerMock(),
    });
    task.start();

    const stopped = task.stop();
    release();
    await stopped;

    expect(finished).toBe(true);
  });
});
