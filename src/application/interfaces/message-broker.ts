/**
 * A message delivered to a consumer. It is an opaque handle for ack/nack: the adapter keeps the
 * broker-specific delivery information (delivery tag, channel) behind it.
 */
export type ConsumedMessage = {
  readonly content: Uint8Array;
  /** true when the broker already delivered this message before (consumer crash, requeue). */
  readonly redelivered: boolean;
};

export type MessageHandler = (message: ConsumedMessage) => Promise<void>;

/**
 * Message broker port (implemented with RabbitMQ / amqplib).
 *
 * Payloads are `Uint8Array` — the web-standard supertype of Node's `Buffer` — so the
 * Application layer does not depend on Node.js APIs.
 */
export interface MessageBroker {
  /** Resolves once the broker has confirmed the message is persisted (publisher confirms). */
  publish(queue: string, message: Uint8Array): Promise<void>;
  /** Starts consuming with manual acknowledgements; `handler` runs once per delivery. */
  consume(queue: string, handler: MessageHandler): Promise<void>;
  ack(message: ConsumedMessage): void;
  /** requeue=false dead-letters the message (poison message → DLQ). */
  nack(message: ConsumedMessage, requeue: boolean): void;
  /** Messages ready for delivery (not counting the unacknowledged ones). */
  getQueueDepth(queue: string): Promise<number>;
  /**
   * Cancels every consumer (AMQP basic.cancel): no new deliveries, while messages already
   * delivered can still be acknowledged. First step of a graceful shutdown.
   */
  stopConsuming(): Promise<void>;
}
