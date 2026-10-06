import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

const booleanFlag = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const port = z.coerce.number().int().min(0).max(65_535);

const optionalUrl = z
  .string()
  .url()
  .optional()
  .or(z.literal('').transform(() => undefined));

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    /** Which process `node dist/index.js` starts (the image runs both). */
    APP_ROLE: z.enum(['api', 'worker']).default('api'),
    PORT: port.default(3000),
    /** Worker /metrics + /health port (Prometheus scrapes every replica). */
    METRICS_PORT: port.default(9464),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    LOG_PRETTY: booleanFlag.default('false'),
    /** Hard deadline for the whole graceful shutdown (keep below the ECS stopTimeout). */
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
    /** How long a stopping worker waits for in-flight messages. */
    SHUTDOWN_DRAIN_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),

    DB_HOST: z.string().min(1),
    DB_PORT: port.default(3306),
    DB_USER: z.string().min(1),
    DB_PASSWORD: z.string(),
    DB_NAME: z.string().min(1),
    DB_POOL_MIN: z.coerce.number().int().min(0).default(0),
    DB_POOL_MAX: z.coerce.number().int().min(1).default(10),
    DB_MIGRATE_ON_START: booleanFlag.default('false'),
    /** true = TLS with the Amazon RDS CA bundle (mysql2 "Amazon RDS" profile). */
    DB_SSL: booleanFlag.default('false'),

    RABBITMQ_URL: z.string().regex(/^amqps?:\/\//, 'must start with amqp:// or amqps://'),
    RABBITMQ_QUEUE: z.string().min(1).default('edtech.tasks'),
    RABBITMQ_DLQ: z.string().min(1).default('edtech.tasks.dlq'),
    /** Unacknowledged messages per worker = how many tasks a worker runs concurrently. */
    RABBITMQ_PREFETCH: z.coerce.number().int().min(1).max(1000).default(10),
    /** Quorum-queue redelivery limit before the broker dead-letters a message by itself. */
    RABBITMQ_DELIVERY_LIMIT: z.coerce.number().int().min(1).default(20),
    RABBITMQ_HEARTBEAT_SECONDS: z.coerce.number().int().min(0).default(30),
    RABBITMQ_CONNECT_RETRIES: z.coerce.number().int().min(0).default(10),
    RABBITMQ_CONNECT_RETRY_DELAY_MS: z.coerce.number().int().min(0).default(2000),
    RABBITMQ_PUBLISH_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),

    TASK_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(3),
    /** Simulated work: mean duration, ± jitter ratio, and transient failure probability. */
    TASK_DURATION_MS: z.coerce.number().int().min(0).default(250),
    TASK_DURATION_JITTER: z.coerce.number().min(0).max(1).default(0.5),
    TASK_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0.02),
    /** Requeue delay after an infrastructure failure (avoids hot redelivery loops). */
    TASK_REQUEUE_DELAY_MS: z.coerce.number().int().min(0).default(2000),

    QUEUE_METRICS_INTERVAL_MS: z.coerce.number().int().min(1000).default(15_000),
    CLOUDWATCH_METRICS_ENABLED: booleanFlag.default('false'),
    CLOUDWATCH_NAMESPACE: z.string().min(1).default('Custom/EdTech'),
    AWS_REGION: z.string().min(1).default('us-east-1'),
    /** LocalStack endpoint (http://localstack:4566). Empty = real AWS. */
    CLOUDWATCH_ENDPOINT: optionalUrl,
  })
  .refine((env) => env.DB_POOL_MIN <= env.DB_POOL_MAX, {
    message: 'DB_POOL_MIN must be less than or equal to DB_POOL_MAX',
    path: ['DB_POOL_MIN'],
  })
  .refine((env) => env.SHUTDOWN_DRAIN_TIMEOUT_MS < env.SHUTDOWN_TIMEOUT_MS, {
    message: 'SHUTDOWN_DRAIN_TIMEOUT_MS must be lower than SHUTDOWN_TIMEOUT_MS',
    path: ['SHUTDOWN_DRAIN_TIMEOUT_MS'],
  })
  .refine((env) => env.RABBITMQ_QUEUE !== env.RABBITMQ_DLQ, {
    message: 'RABBITMQ_DLQ must differ from RABBITMQ_QUEUE',
    path: ['RABBITMQ_DLQ'],
  });

export type LogLevel = z.infer<typeof envSchema>['LOG_LEVEL'];
export type ServiceRole = z.infer<typeof envSchema>['APP_ROLE'];

export type DatabaseConfig = {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly name: string;
  readonly pool: { readonly min: number; readonly max: number };
  readonly migrateOnStart: boolean;
  readonly ssl: boolean;
};

export type RabbitMqConfig = {
  readonly url: string;
  readonly queue: string;
  readonly deadLetterQueue: string;
  readonly prefetch: number;
  readonly deliveryLimit: number;
  readonly heartbeatSeconds: number;
  readonly connectRetries: number;
  readonly connectRetryDelayMs: number;
  readonly publishTimeoutMs: number;
};

export type WorkSimulationConfig = {
  readonly durationMs: number;
  readonly jitter: number;
  readonly failureRate: number;
};

export type AppConfig = {
  readonly env: 'development' | 'test' | 'production';
  readonly role: ServiceRole;
  readonly http: { readonly port: number; readonly metricsPort: number };
  readonly log: { readonly level: LogLevel; readonly pretty: boolean };
  readonly database: DatabaseConfig;
  readonly rabbitmq: RabbitMqConfig;
  readonly tasks: {
    readonly maxAttempts: number;
    readonly requeueDelayMs: number;
    readonly simulation: WorkSimulationConfig;
  };
  readonly metrics: {
    readonly queueSampleIntervalMs: number;
    readonly cloudWatch: {
      readonly enabled: boolean;
      readonly namespace: string;
      readonly region: string;
      readonly endpoint: string | undefined;
    };
  };
  readonly shutdown: { readonly timeoutMs: number; readonly drainTimeoutMs: number };
};

export class ConfigValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigValidationError';
  }
}

/** Loads `.env` (if present) into process.env without overriding variables already set. */
export const loadEnvFile = (path?: string): void => {
  loadDotenv({ path, quiet: true });
};

/** Validates the environment once at startup: the process refuses to boot with a bad config. */
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigValidationError(
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  const vars = parsed.data;

  return {
    env: vars.NODE_ENV,
    role: vars.APP_ROLE,
    http: { port: vars.PORT, metricsPort: vars.METRICS_PORT },
    log: { level: vars.LOG_LEVEL, pretty: vars.LOG_PRETTY },
    database: {
      host: vars.DB_HOST,
      port: vars.DB_PORT,
      user: vars.DB_USER,
      password: vars.DB_PASSWORD,
      name: vars.DB_NAME,
      pool: { min: vars.DB_POOL_MIN, max: vars.DB_POOL_MAX },
      migrateOnStart: vars.DB_MIGRATE_ON_START,
      ssl: vars.DB_SSL,
    },
    rabbitmq: {
      url: vars.RABBITMQ_URL,
      queue: vars.RABBITMQ_QUEUE,
      deadLetterQueue: vars.RABBITMQ_DLQ,
      prefetch: vars.RABBITMQ_PREFETCH,
      deliveryLimit: vars.RABBITMQ_DELIVERY_LIMIT,
      heartbeatSeconds: vars.RABBITMQ_HEARTBEAT_SECONDS,
      connectRetries: vars.RABBITMQ_CONNECT_RETRIES,
      connectRetryDelayMs: vars.RABBITMQ_CONNECT_RETRY_DELAY_MS,
      publishTimeoutMs: vars.RABBITMQ_PUBLISH_TIMEOUT_MS,
    },
    tasks: {
      maxAttempts: vars.TASK_MAX_ATTEMPTS,
      requeueDelayMs: vars.TASK_REQUEUE_DELAY_MS,
      simulation: {
        durationMs: vars.TASK_DURATION_MS,
        jitter: vars.TASK_DURATION_JITTER,
        failureRate: vars.TASK_FAILURE_RATE,
      },
    },
    metrics: {
      queueSampleIntervalMs: vars.QUEUE_METRICS_INTERVAL_MS,
      cloudWatch: {
        enabled: vars.CLOUDWATCH_METRICS_ENABLED,
        namespace: vars.CLOUDWATCH_NAMESPACE,
        region: vars.AWS_REGION,
        endpoint: vars.CLOUDWATCH_ENDPOINT,
      },
    },
    shutdown: {
      timeoutMs: vars.SHUTDOWN_TIMEOUT_MS,
      drainTimeoutMs: vars.SHUTDOWN_DRAIN_TIMEOUT_MS,
    },
  };
};
