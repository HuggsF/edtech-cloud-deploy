import { EventEmitter } from 'node:events';
import type { ChannelModel, ConsumeMessage } from 'amqplib';
import type { ConsumedMessage } from '@application/interfaces/message-broker';
import { RabbitMqMessageBroker } from '@infrastructure/queue/rabbitmq.message-broker';
import type {
  ConnectFn,
  RabbitMqBrokerOptions,
} from '@infrastructure/queue/rabbitmq.message-broker';
import { createLoggerMock } from '../../support/fakes';

/** Minimal in-memory stand-in for an amqplib channel: enough to test the adapter's logic. */
class FakeChannel extends EventEmitter {
  readonly asserted: { queue: string; options: unknown }[] = [];
  readonly acked: unknown[] = [];
  readonly nacked: { message: unknown; requeue: boolean }[] = [];
  readonly cancelled: string[] = [];
  onMessage: ((message: ConsumeMessage | null) => void) | null = null;
  prefetchCount = 0;
  closedForOps = false;
  confirmError: unknown = null;
  confirmNever = false;

  assertQueue(queue: string, options: unknown): Promise<object> {
    this.asserted.push({ queue, options });
    return Promise.resolve({});
  }

  checkQueue(_queue: string): Promise<{ messageCount: number }> {
    return Promise.resolve({ messageCount: 7 });
  }

  prefetch(count: number): Promise<object> {
    this.prefetchCount = count;
    return Promise.resolve({});
  }

  consume(
    _queue: string,
    onMessage: (message: ConsumeMessage | null) => void,
  ): Promise<{ consumerTag: string }> {
    this.onMessage = onMessage;
    return Promise.resolve({ consumerTag: 'ctag-1' });
  }

  cancel(consumerTag: string): Promise<object> {
    this.cancelled.push(consumerTag);
    return Promise.resolve({});
  }

  sendToQueue(_q: string, _c: Buffer, _o: unknown, callback: (error: unknown) => void): boolean {
    if (!this.confirmNever) {
      setImmediate(() => {
        callback(this.confirmError);
      });
    }
    return true;
  }

  ack(message: unknown): void {
    if (this.closedForOps) {
      throw new Error('Channel closed');
    }
    this.acked.push(message);
  }

  nack(message: unknown, _allUpTo: boolean, requeue: boolean): void {
    this.nacked.push({ message, requeue });
  }

  close(): Promise<void> {
    this.emit('close');
    return Promise.resolve();
  }
}

class FakeConnection extends EventEmitter {
  readonly channels: FakeChannel[] = [];
  closed = false;

  createChannel(): Promise<FakeChannel> {
    const channel = new FakeChannel();
    this.channels.push(channel);
    return Promise.resolve(channel);
  }

  createConfirmChannel(): Promise<FakeChannel> {
    return this.createChannel();
  }

  close(): Promise<void> {
    this.closed = true;
    this.emit('close');
    return Promise.resolve();
  }
}

const OPTIONS: RabbitMqBrokerOptions = {
  url: 'amqp://guest:guest@localhost:5672',
  queue: 'edtech.tasks',
  deadLetterQueue: 'edtech.tasks.dlq',
  prefetch: 5,
  deliveryLimit: 20,
  heartbeatSeconds: 30,
  connectRetries: 2,
  connectRetryDelayMs: 1,
  publishTimeoutMs: 50,
  connectionName: 'edtech-test',
};

const rawMessage = (content: string): ConsumeMessage =>
  ({ content: Buffer.from(content), fields: { redelivered: false } }) as unknown as ConsumeMessage;

const connected = async (
  connection = new FakeConnection(),
  logger = createLoggerMock(),
): Promise<{ broker: RabbitMqMessageBroker; connection: FakeConnection; urls: string[] }> => {
  const urls: string[] = [];
  const connectFn: ConnectFn = (url) => {
    urls.push(url);
    return Promise.resolve(connection as unknown as ChannelModel);
  };
  const broker = await RabbitMqMessageBroker.connect(OPTIONS, logger, connectFn);
  return { broker, connection, urls };
};

describe('RabbitMqMessageBroker (unit, fake amqplib)', () => {
  it('declares quorum queues with dead-lettering and a delivery limit', async () => {
    const { connection, urls } = await connected();

    expect(urls).toEqual(['amqp://guest:guest@localhost:5672?heartbeat=30']);
    expect(connection.channels[0]?.asserted).toEqual([
      {
        queue: 'edtech.tasks.dlq',
        options: { durable: true, arguments: { 'x-queue-type': 'quorum' } },
      },
      {
        queue: 'edtech.tasks',
        options: {
          durable: true,
          arguments: {
            'x-queue-type': 'quorum',
            'x-dead-letter-exchange': '',
            'x-dead-letter-routing-key': 'edtech.tasks.dlq',
            'x-delivery-limit': 20,
          },
        },
      },
    ]);
  });

  it('retries the connection while the broker is starting, then gives up', async () => {
    const logger = createLoggerMock();
    let calls = 0;
    const flaky: ConnectFn = () => {
      calls += 1;
      return calls < 3
        ? Promise.reject(new Error('ECONNREFUSED'))
        : Promise.resolve(new FakeConnection() as unknown as ChannelModel);
    };

    await expect(RabbitMqMessageBroker.connect(OPTIONS, logger, flaky)).resolves.toBeInstanceOf(
      RabbitMqMessageBroker,
    );
    expect(logger.warn).toHaveBeenCalledTimes(2);

    const down: ConnectFn = () => Promise.reject(new Error('ECONNREFUSED'));
    await expect(RabbitMqMessageBroker.connect(OPTIONS, logger, down)).rejects.toThrow(
      'ECONNREFUSED',
    );
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    const weird: ConnectFn = () => Promise.reject('not an error');
    await expect(
      RabbitMqMessageBroker.connect({ ...OPTIONS, connectRetries: 0 }, logger, weird),
    ).rejects.toThrow('not an error');
  });

  it('resolves publish on the broker confirm and rejects on a nack or a timeout', async () => {
    const { broker, connection } = await connected();

    await expect(broker.publish('edtech.tasks', new Uint8Array([1, 2]))).resolves.toBeUndefined();
    const channel = connection.channels[1]!;
    channel.confirmError = new Error('message nacked');
    await expect(broker.publish('edtech.tasks', new Uint8Array([1]))).rejects.toThrow(
      'message nacked',
    );
    channel.confirmNever = true;
    await expect(broker.publish('edtech.tasks', new Uint8Array([1]))).rejects.toThrow(
      'Publisher confirm not received within 50 ms',
    );
    // The confirm channel is reused while open, recreated once closed.
    await channel.close();
    await broker.publish('edtech.tasks', new Uint8Array([1]));
    expect(connection.channels).toHaveLength(3);
  });

  it('consumes with a prefetch and settles messages through the opaque handle', async () => {
    const { broker, connection } = await connected();
    const received: ConsumedMessage[] = [];

    await broker.consume('edtech.tasks', (message) => {
      received.push(message);
      return Promise.resolve();
    });
    const channel = connection.channels[1]!;
    expect(channel.prefetchCount).toBe(5);
    expect(broker.activeConsumers).toBe(1);

    const first = rawMessage('{"a":1}');
    const second = rawMessage('{"b":2}');
    channel.onMessage?.(first);
    channel.onMessage?.(second);
    broker.ack(received[0]!);
    broker.nack(received[1]!, false);

    expect(new TextDecoder().decode(received[0]!.content)).toBe('{"a":1}');
    expect(channel.acked).toEqual([first]);
    expect(channel.nacked).toEqual([{ message: second, requeue: false }]);
  });

  it('requeues a message whose handler throws, and ignores double settlement', async () => {
    const logger = createLoggerMock();
    const { broker, connection } = await connected(new FakeConnection(), logger);
    await broker.consume('edtech.tasks', () => Promise.reject(new Error('bug')));
    const channel = connection.channels[1]!;

    channel.onMessage?.(rawMessage('x'));
    await new Promise((resolve) => setImmediate(resolve));

    expect(channel.nacked).toEqual([{ message: expect.anything() as unknown, requeue: true }]);
    broker.ack({ content: new Uint8Array(), redelivered: false });
    expect(logger.warn).toHaveBeenCalledWith(
      { action: 'ack' },
      'Message already settled or unknown',
    );
  });

  it('logs instead of throwing when acking on a closed channel (the broker redelivers)', async () => {
    const logger = createLoggerMock();
    const { broker, connection } = await connected(new FakeConnection(), logger);
    let delivered: ConsumedMessage | undefined;
    await broker.consume('edtech.tasks', (message) => {
      delivered = message;
      return Promise.resolve();
    });
    const channel = connection.channels[1]!;
    channel.onMessage?.(rawMessage('x'));
    channel.closedForOps = true;

    expect(() => {
      broker.ack(delivered!);
    }).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ack' }),
      'Could not settle message, it will be redelivered',
    );
  });

  it('cancels consumers on stopConsuming and reports queue depth', async () => {
    const { broker, connection } = await connected();
    await broker.consume('edtech.tasks', () => Promise.resolve());

    await broker.stopConsuming();

    expect(connection.channels[1]?.cancelled).toEqual(['ctag-1']);
    expect(broker.activeConsumers).toBe(0);
    expect(await broker.getQueueDepth('edtech.tasks')).toBe(7);
    await expect(broker.ping()).resolves.toBeUndefined();
  });

  it('reports a lost connection or a broker-cancelled consumer, but not its own close', async () => {
    const { broker, connection } = await connected();
    const lost = jest.fn();
    broker.onConnectionLost(lost);
    await broker.consume('edtech.tasks', () => Promise.resolve());

    connection.channels[1]?.onMessage?.(null);
    expect(lost).toHaveBeenCalledTimes(1);

    connection.emit('blocked', 'memory alarm');
    connection.emit('unblocked');
    connection.emit('error', new Error('socket hang up'));
    connection.emit('close', new Error('CONNECTION_FORCED'));
    expect(lost).toHaveBeenCalledTimes(2);
    expect(broker.isConnected).toBe(false);
    await expect(broker.ping()).rejects.toThrow('RabbitMQ connection is closed');
    await broker.close(); // already closed: no-op

    const second = await connected();
    const notLost = jest.fn();
    second.broker.onConnectionLost(notLost);
    await second.broker.close();
    await second.broker.close();
    expect(notLost).not.toHaveBeenCalled();
    expect(second.connection.closed).toBe(true);
  });
});
