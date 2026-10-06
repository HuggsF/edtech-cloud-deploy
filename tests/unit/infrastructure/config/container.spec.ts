import { EventEmitter } from 'node:events';
import type { ChannelModel, ConsumeMessage } from 'amqplib';
import { createContainer } from '@infrastructure/config/container';
import type { AppConfig } from '@infrastructure/config/env';
import type { ConnectFn } from '@infrastructure/queue/rabbitmq.message-broker';
import { createLoggerMock } from '../../../support/fakes';

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
const mockRaw = jest.fn().mockResolvedValue(undefined);
const mockDb = Object.assign(jest.fn(), {
  destroy: mockDestroy,
  raw: mockRaw,
  client: { pool: { numUsed: () => 1, numFree: () => 2 } },
});

jest.mock('@infrastructure/database/knex', () => ({
  createDatabase: jest.fn(() => mockDb),
  openConnections: jest.fn(() => 3),
  pingDatabase: jest.fn().mockResolvedValue(undefined),
}));

describe('Container Composition Root', () => {
  const fakeConfig: AppConfig = {
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
      migrateOnStart: false,
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
        enabled: true,
        namespace: 'Custom/EdTech',
        region: 'us-east-1',
        endpoint: undefined,
      },
    },
    shutdown: { timeoutMs: 10000, drainTimeoutMs: 5000 },
    log: { level: 'info', pretty: false },
  };

  const fakeConnect: ConnectFn = () =>
    Promise.resolve(new FakeConnection() as unknown as ChannelModel);

  it('wires all use cases, adapters and metrics for role api', async () => {
    const logger = createLoggerMock();
    const container = await createContainer(fakeConfig, logger, 'api', {
      connectBroker: fakeConnect,
    });

    expect(container).toBeDefined();
    expect(container.role).toBe('api');
    expect(container.enqueueTask).toBeDefined();
    expect(container.processTask).toBeDefined();
    expect(container.getTaskStatus).toBeDefined();
    expect(container.getTaskStats).toBeDefined();
    expect(container.getSystemHealth).toBeDefined();
    expect(container.recordQueueMetrics).toBeDefined();
    expect(container.broker.isConnected).toBe(true);

    const metricsOutput = await container.metrics.getMetricsOutput();
    expect(metricsOutput).toContain('active_connections');
  });

  it('destroys db and throws if broker connection fails during startup', async () => {
    const logger = createLoggerMock();
    const failingConnect: ConnectFn = () => Promise.reject(new Error('Broker unreachable'));

    await expect(
      createContainer(fakeConfig, logger, 'api', {
        connectBroker: failingConnect,
      }),
    ).rejects.toThrow('Broker unreachable');

    expect(mockDestroy).toHaveBeenCalled();
  });
});
