import { ConfigValidationError, loadConfig } from '@infrastructure/config/env';

const REQUIRED = {
  DB_HOST: 'localhost',
  DB_USER: 'root',
  DB_PASSWORD: 'secret',
  DB_NAME: 'edtech',
  RABBITMQ_URL: 'amqp://guest:guest@localhost:5672',
};

const issuesOf = (env: NodeJS.ProcessEnv): string[] => {
  try {
    loadConfig(env);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ConfigValidationError);
    return [...(error as ConfigValidationError).issues];
  }
  throw new Error('expected an invalid configuration');
};

describe('loadConfig', () => {
  it('applies defaults to optional variables', () => {
    expect(loadConfig(REQUIRED)).toEqual({
      env: 'development',
      role: 'api',
      http: { port: 3000, metricsPort: 9464 },
      log: { level: 'info', pretty: false },
      database: {
        host: 'localhost',
        port: 3306,
        user: 'root',
        password: 'secret',
        name: 'edtech',
        pool: { min: 0, max: 10 },
        migrateOnStart: false,
        ssl: false,
      },
      rabbitmq: {
        url: 'amqp://guest:guest@localhost:5672',
        queue: 'edtech.tasks',
        deadLetterQueue: 'edtech.tasks.dlq',
        prefetch: 10,
        deliveryLimit: 20,
        heartbeatSeconds: 30,
        connectRetries: 10,
        connectRetryDelayMs: 2000,
        publishTimeoutMs: 5000,
      },
      tasks: {
        maxAttempts: 3,
        requeueDelayMs: 2000,
        simulation: { durationMs: 250, jitter: 0.5, failureRate: 0.02 },
      },
      metrics: {
        queueSampleIntervalMs: 15_000,
        cloudWatch: {
          enabled: false,
          namespace: 'Custom/EdTech',
          region: 'us-east-1',
          endpoint: undefined,
        },
      },
      shutdown: { timeoutMs: 45_000, drainTimeoutMs: 30_000 },
    });
  });

  it('coerces numbers, flags and optional URLs', () => {
    const config = loadConfig({
      ...REQUIRED,
      APP_ROLE: 'worker',
      PORT: '8080',
      RABBITMQ_PREFETCH: '25',
      LOG_PRETTY: 'true',
      DB_SSL: '1',
      CLOUDWATCH_METRICS_ENABLED: 'true',
      CLOUDWATCH_ENDPOINT: 'http://localstack:4566',
      TASK_FAILURE_RATE: '0.1',
    });

    expect(config.role).toBe('worker');
    expect(config.http.port).toBe(8080);
    expect(config.rabbitmq.prefetch).toBe(25);
    expect(config.log.pretty).toBe(true);
    expect(config.database.ssl).toBe(true);
    expect(config.metrics.cloudWatch).toMatchObject({
      enabled: true,
      endpoint: 'http://localstack:4566',
    });
    expect(config.tasks.simulation.failureRate).toBe(0.1);
  });

  it('treats an empty CloudWatch endpoint as "use the real AWS endpoint"', () => {
    expect(
      loadConfig({ ...REQUIRED, CLOUDWATCH_ENDPOINT: '' }).metrics.cloudWatch.endpoint,
    ).toBeUndefined();
  });

  it('lists every missing or invalid variable', () => {
    const fields = issuesOf({
      RABBITMQ_URL: 'http://rabbit',
      LOG_LEVEL: 'loud',
      TASK_FAILURE_RATE: '2',
    }).map((issue) => issue.split(':')[0]);

    expect(fields).toEqual(
      expect.arrayContaining([
        'LOG_LEVEL',
        'DB_HOST',
        'DB_USER',
        'DB_PASSWORD',
        'DB_NAME',
        'RABBITMQ_URL',
        'TASK_FAILURE_RATE',
      ]),
    );
  });

  it('checks cross-field rules', () => {
    expect(issuesOf({ ...REQUIRED, DB_POOL_MIN: '20', DB_POOL_MAX: '5' })[0]).toContain(
      'DB_POOL_MIN',
    );
    expect(
      issuesOf({
        ...REQUIRED,
        SHUTDOWN_TIMEOUT_MS: '10000',
        SHUTDOWN_DRAIN_TIMEOUT_MS: '30000',
      })[0],
    ).toContain('SHUTDOWN_DRAIN_TIMEOUT_MS must be lower than SHUTDOWN_TIMEOUT_MS');
    expect(issuesOf({ ...REQUIRED, RABBITMQ_DLQ: 'edtech.tasks' })[0]).toContain('RABBITMQ_DLQ');
  });

  it('formats a readable error message', () => {
    expect(() => loadConfig({})).toThrow(/Invalid environment configuration:\n {2}- /);
  });
});
