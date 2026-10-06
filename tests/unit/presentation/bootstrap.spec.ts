import { EventEmitter } from 'node:events';
import type { ChannelModel, ConsumeMessage } from 'amqplib';
import type { AppConfig } from '@infrastructure/config/env';
import type { ConnectFn } from '@infrastructure/queue/rabbitmq.message-broker';
import { startApi } from '@presentation/bootstrap/start-api';
import { startWorker } from '@presentation/bootstrap/start-worker';
import { createLoggerMock } from '../../support/fakes';

class FakeChannel extends EventEmitter {
  prefetch(_count: number): Promise<object> {
    return Promise.resolve({});
  }
  assertQueue(_queue: string, _options: unknown): Promise<object> {
    return Promise.resolve({});
  }
  checkQueue(_queue: string): Promise<{ messageCount: number }> {
    return Promise.resolve({ messageCount: 0 });
  }
  consume(
    _queue: string,
    _onMessage: (message: ConsumeMessage | null) => void,
  ): Promise<{ consumerTag: string }> {
    return Promise.resolve({ consumerTag: 'ctag' });
  }
  cancel(_consumerTag: string): Promise<object> {
    return Promise.resolve({});
  }
  sendToQueue(_q: string, _c: Buffer, _o: unknown, callback: (error: unknown) => void): boolean {
    setImmediate(() => {
      callback(null);
    });
    return true;
  }
  ack(): void {
    // noop
  }
  nack(): void {
    // noop
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

class FakeConnection extends EventEmitter {
  createChannel(): Promise<FakeChannel> {
    return Promise.resolve(new FakeChannel());
  }
  createConfirmChannel(): Promise<FakeChannel> {
    return Promise.resolve(new FakeChannel());
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

const mockDestroy = jest.fn().mockResolvedValue(undefined);
const mockDb = Object.assign(jest.fn(), {
  destroy: mockDestroy,
  raw: jest.fn().mockResolvedValue(undefined),
  client: { pool: { numUsed: () => 0, numFree: () => 1 } },
});

jest.mock('@infrastructure/database/knex', () => ({
  createDatabase: jest.fn(() => mockDb),
  openConnections: jest.fn(() => 1),
  pingDatabase: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@infrastructure/database/migrator', () => ({
  migrateLatest: jest.fn().mockResolvedValue(['20260101000000_create_tasks_table']),
  migrateRollback: jest.fn().mockResolvedValue([]),
}));

jest.mock('@presentation/http/server', () => {
  const { EventEmitter: EE } =
    jest.requireActual<{ EventEmitter: typeof EventEmitter }>('node:events');
  const server = Object.assign(new EE(), {
    address: () => ({ port: 3000 }),
    close: jest.fn((cb?: (err?: Error) => void) => {
      if (cb) cb();
    }),
    closeIdleConnections: jest.fn(),
  });
  return {
    listen: jest.fn().mockResolvedValue(server),
    boundPort: jest.fn().mockReturnValue(3000),
    trackConnections: jest.fn().mockReturnValue(() => 0),
    closeServer: jest.fn().mockResolvedValue(undefined),
  };
});

describe('Bootstrap Services', () => {
  const baseConfig: AppConfig = {
    env: 'test',
    role: 'api',
    http: { port: 3000, metricsPort: 9090 },
    database: {
      host: 'localhost',
      port: 3306,
      user: 'root',
      password: 'password',
      name: 'edtech',
      ssl: false,
      pool: { min: 2, max: 10 },
      migrateOnStart: true,
    },
    rabbitmq: {
      url: 'amqp://guest:guest@localhost:5672',
      queue: 'edtech.tasks',
      deadLetterQueue: 'edtech.tasks.dlq',
      prefetch: 10,
      deliveryLimit: 20,
      heartbeatSeconds: 30,
      connectRetries: 3,
      connectRetryDelayMs: 100,
      publishTimeoutMs: 5000,
    },
    tasks: {
      maxAttempts: 3,
      requeueDelayMs: 1000,
      simulation: { durationMs: 50, jitter: 0.1, failureRate: 0 },
    },
    metrics: {
      queueSampleIntervalMs: 5000,
      cloudWatch: {
        enabled: false,
        namespace: 'Custom/EdTech',
        region: 'us-east-1',
        endpoint: undefined,
      },
    },
    shutdown: { timeoutMs: 10000, drainTimeoutMs: 5000 },
    log: { level: 'info', pretty: false },
  };

  const connectBroker: ConnectFn = () =>
    Promise.resolve(new FakeConnection() as unknown as ChannelModel);

  describe('startApi', () => {
    it('initializes container, applies migrations, starts http server, and returns shutdown tasks', async () => {
      const logger = createLoggerMock();
      const service = await startApi(baseConfig, logger, { connectBroker });

      expect(service.port).toBe(3000);
      expect(service.container.role).toBe('api');
      expect(service.shutdownTasks).toHaveLength(4);

      // Execute shutdown tasks
      for (const task of service.shutdownTasks) {
        await task.close();
      }
    });
  });

  describe('startWorker', () => {
    it('initializes worker runtime, metrics server, starts consuming, and returns shutdown tasks', async () => {
      const logger = createLoggerMock();
      const worker = await startWorker(baseConfig, logger, { connectBroker });

      expect(worker.port).toBe(3000);
      expect(worker.container.role).toBe('worker');
      expect(worker.shutdownTasks).toHaveLength(4);
      expect(worker.runtime).toBeDefined();
      expect(worker.inFlight).toBeDefined();

      for (const task of worker.shutdownTasks) {
        await task.close();
      }
    });
  });
});
