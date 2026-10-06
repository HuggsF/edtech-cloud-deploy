import { hostname } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { connect as amqpConnect } from 'amqplib';
import type { Channel, ChannelModel, ConfirmChannel, ConsumeMessage } from 'amqplib';
import { errorMessage } from '@application/errors/error-message';
import type { Logger } from '@application/interfaces/logger';
import type {
  ConsumedMessage,
  MessageBroker,
  MessageHandler,
} from '@application/interfaces/message-broker';
import type { RabbitMqConfig } from '@infrastructure/config/env';

export type RabbitMqBrokerOptions = RabbitMqConfig & {
  /** Shown in the RabbitMQ management UI (e.g. "edtech-worker@ip-10-0-1-23"). */
  readonly connectionName: string;
};

export type ConnectFn = (url: string, socketOptions: object) => Promise<ChannelModel>;

type Delivery = { readonly raw: ConsumeMessage; readonly channel: Channel };
type Consumer = { readonly channel: Channel; readonly consumerTag: string };

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(errorMessage(error));

const withHeartbeat = (url: string, heartbeatSeconds: number): string => {
  const parsed = new URL(url);
  if (!parsed.searchParams.has('heartbeat')) {
    parsed.searchParams.set('heartbeat', String(heartbeatSeconds));
  }
  return parsed.toString();
};

/**
 * RabbitMQ adapter (amqplib).
 *
 * - Topology: durable **quorum** queues (replicated on a multi-AZ Amazon MQ cluster) and a
 *   dead-letter queue. `x-delivery-limit` makes the broker dead-letter a message that keeps
 *   crashing consumers, even if no consumer ever gets to nack it.
 * - Publishing: confirm channel + persistent messages; `publish` resolves on the broker ack.
 * - Consuming: manual acks with a prefetch window (= tasks processed concurrently per worker).
 * - Failure policy: no in-process reconnection. A lost connection is reported to the process,
 *   which exits so the orchestrator (ECS / Docker) starts a fresh, stateless replica.
 */
export class RabbitMqMessageBroker implements MessageBroker {
  private publishChannel: Promise<ConfirmChannel> | null = null;
  private queryChannel: Promise<Channel> | null = null;
  private readonly consumers: Consumer[] = [];
  private readonly deliveries = new WeakMap<ConsumedMessage, Delivery>();
  private readonly lostListeners: ((error: Error) => void)[] = [];
  private connected = true;
  private closing = false;

  private constructor(
    private readonly connection: ChannelModel,
    private readonly options: RabbitMqBrokerOptions,
    private readonly logger: Logger,
  ) {
    connection.on('error', (error: Error) => {
      logger.error({ err: error }, 'RabbitMQ connection error');
    });
    connection.on('close', (error?: Error) => {
      this.connected = false;
      if (!this.closing) {
        this.notifyLost(error ?? new Error('RabbitMQ connection closed by the broker'));
      }
    });
    connection.on('blocked', (reason: string) => {
      logger.warn({ reason }, 'RabbitMQ connection blocked (broker resource alarm)');
    });
    connection.on('unblocked', () => {
      logger.info({}, 'RabbitMQ connection unblocked');
    });
  }

  /** Connects (retrying while the broker is still starting) and declares the topology. */
  static async connect(
    options: RabbitMqBrokerOptions,
    logger: Logger,
    connectFn: ConnectFn = amqpConnect,
  ): Promise<RabbitMqMessageBroker> {
    const url = withHeartbeat(options.url, options.heartbeatSeconds);
    for (let attempt = 0; ; attempt += 1) {
      try {
        const connection = await connectFn(url, {
          clientProperties: { connection_name: options.connectionName },
        });
        const broker = new RabbitMqMessageBroker(connection, options, logger);
        await broker.assertTopology();
        logger.info(
          { queue: options.queue, dlq: options.deadLetterQueue },
          'Connected to RabbitMQ',
        );
        return broker;
      } catch (error: unknown) {
        if (attempt >= options.connectRetries) {
          throw toError(error);
        }
        logger.warn(
          { err: error, attempt: attempt + 1, retries: options.connectRetries },
          'RabbitMQ not reachable yet, retrying',
        );
        await sleep(options.connectRetryDelayMs);
      }
    }
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get activeConsumers(): number {
    return this.consumers.length;
  }

  onConnectionLost(listener: (error: Error) => void): void {
    this.lostListeners.push(listener);
  }

  async publish(queue: string, message: Uint8Array): Promise<void> {
    const channel = await this.getPublishChannel();
    const content = Buffer.from(message.buffer, message.byteOffset, message.byteLength);
    let timer: NodeJS.Timeout | undefined;
    const confirmed = new Promise<void>((resolve, reject) => {
      channel.sendToQueue(
        queue,
        content,
        {
          persistent: true,
          contentType: 'application/json',
          timestamp: Math.floor(Date.now() / 1000),
        },
        (error: unknown) => {
          if (error === null || error === undefined) {
            resolve();
          } else {
            reject(toError(error));
          }
        },
      );
    });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new Error(`Publisher confirm not received within ${this.options.publishTimeoutMs} ms`),
        );
      }, this.options.publishTimeoutMs);
    });
    try {
      await Promise.race([confirmed, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async consume(queue: string, handler: MessageHandler): Promise<void> {
    const channel = await this.connection.createChannel();
    channel.on('error', (error: Error) => {
      this.logger.error({ err: error, queue }, 'RabbitMQ consumer channel error');
    });
    await channel.prefetch(this.options.prefetch);
    const { consumerTag } = await channel.consume(
      queue,
      (raw) => {
        if (raw === null) {
          // The broker cancelled the consumer (queue deleted, node shutdown…).
          this.notifyLost(new Error(`Consumer of ${queue} was cancelled by the broker`));
          return;
        }
        const message: ConsumedMessage = {
          content: raw.content,
          redelivered: raw.fields.redelivered,
        };
        this.deliveries.set(message, { raw, channel });
        handler(message).catch((error: unknown) => {
          this.logger.error({ err: error, queue }, 'Message handler failed, requeueing');
          this.nack(message, true);
        });
      },
      { noAck: false },
    );
    this.consumers.push({ channel, consumerTag });
    this.logger.info({ queue, consumerTag, prefetch: this.options.prefetch }, 'Consuming');
  }

  ack(message: ConsumedMessage): void {
    this.settle(message, 'ack', (delivery) => {
      delivery.channel.ack(delivery.raw);
    });
  }

  nack(message: ConsumedMessage, requeue: boolean): void {
    this.settle(message, requeue ? 'requeue' : 'dead-letter', (delivery) => {
      delivery.channel.nack(delivery.raw, false, requeue);
    });
  }

  async getQueueDepth(queue: string): Promise<number> {
    const channel = await this.getQueryChannel();
    const { messageCount } = await channel.checkQueue(queue);
    return messageCount;
  }

  async stopConsuming(): Promise<void> {
    const consumers = this.consumers.splice(0);
    await Promise.all(
      consumers.map(async ({ channel, consumerTag }) => {
        await channel.cancel(consumerTag);
        this.logger.info({ consumerTag }, 'Consumer cancelled');
      }),
    );
  }

  /** Health probe: the connection is open and the work queue exists. */
  async ping(): Promise<void> {
    if (!this.connected) {
      throw new Error('RabbitMQ connection is closed');
    }
    await this.getQueueDepth(this.options.queue);
  }

  /** Closes channels and the connection. Unacknowledged messages are requeued by the broker. */
  async close(): Promise<void> {
    if (this.closing) {
      return;
    }
    this.closing = true;
    if (!this.connected) {
      return;
    }
    try {
      await this.stopConsuming();
    } catch (error: unknown) {
      this.logger.warn({ err: error }, 'Could not cancel consumers before closing');
    }
    await this.connection.close();
    this.connected = false;
  }

  private async assertTopology(): Promise<void> {
    const channel = await this.connection.createChannel();
    try {
      await channel.assertQueue(this.options.deadLetterQueue, {
        durable: true,
        arguments: { 'x-queue-type': 'quorum' },
      });
      await channel.assertQueue(this.options.queue, {
        durable: true,
        arguments: {
          'x-queue-type': 'quorum',
          'x-dead-letter-exchange': '',
          'x-dead-letter-routing-key': this.options.deadLetterQueue,
          'x-delivery-limit': this.options.deliveryLimit,
        },
      });
    } finally {
      await channel.close();
    }
  }

  private settle(
    message: ConsumedMessage,
    action: string,
    apply: (delivery: Delivery) => void,
  ): void {
    const delivery = this.deliveries.get(message);
    if (delivery === undefined) {
      this.logger.warn({ action }, 'Message already settled or unknown');
      return;
    }
    this.deliveries.delete(message);
    try {
      apply(delivery);
    } catch (error: unknown) {
      // Channel already closed: the broker redelivers the message to another consumer.
      this.logger.warn({ err: error, action }, 'Could not settle message, it will be redelivered');
    }
  }

  private getPublishChannel(): Promise<ConfirmChannel> {
    this.publishChannel ??= this.openChannel(
      () => this.connection.createConfirmChannel(),
      () => {
        this.publishChannel = null;
      },
    );
    return this.publishChannel;
  }

  private getQueryChannel(): Promise<Channel> {
    this.queryChannel ??= this.openChannel(
      () => this.connection.createChannel(),
      () => {
        this.queryChannel = null;
      },
    );
    return this.queryChannel;
  }

  /** Lazily opened channel, forgotten when closed (e.g. after a 404 on checkQueue). */
  private async openChannel<C extends Channel>(
    create: () => Promise<C>,
    forget: () => void,
  ): Promise<C> {
    try {
      const channel = await create();
      channel.on('error', (error: Error) => {
        this.logger.warn({ err: error }, 'RabbitMQ channel error');
      });
      channel.on('close', forget);
      return channel;
    } catch (error: unknown) {
      forget();
      throw toError(error);
    }
  }

  private notifyLost(error: Error): void {
    this.logger.error({ err: error }, 'RabbitMQ connection lost');
    for (const listener of this.lostListeners) {
      listener(error);
    }
  }
}

export const defaultConnectionName = (role: string): string => `edtech-${role}@${hostname()}`;
