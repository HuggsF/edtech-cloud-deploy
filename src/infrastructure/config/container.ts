import type { Knex } from 'knex';
import type { AutoscalingMetricsPublisher } from '@application/interfaces/autoscaling-metrics-publisher';
import type { Logger } from '@application/interfaces/logger';
import type { WorkSimulator } from '@application/interfaces/work-simulator';
import { TaskProcessorRegistry } from '@application/services/processors/task-processor.registry';
import { EnqueueTaskUseCase } from '@application/use-cases/enqueue-task.use-case';
import { GetSystemHealthUseCase } from '@application/use-cases/get-system-health.use-case';
import { GetTaskStatsUseCase } from '@application/use-cases/get-task-stats.use-case';
import { GetTaskStatusUseCase } from '@application/use-cases/get-task-status.use-case';
import { ProcessTaskUseCase } from '@application/use-cases/process-task.use-case';
import { RecordQueueMetricsUseCase } from '@application/use-cases/record-queue-metrics.use-case';
import {
  CloudWatchAutoscalingMetricsPublisher,
  NoopAutoscalingMetricsPublisher,
} from '@infrastructure/aws/cloudwatch.autoscaling-metrics-publisher';
import type { AppConfig, ServiceRole } from '@infrastructure/config/env';
import { createDatabase, openConnections, pingDatabase } from '@infrastructure/database/knex';
import { MySqlTaskRepository } from '@infrastructure/database/mysql-task.repository';
import { PrometheusMetricsExporter } from '@infrastructure/metrics/prometheus.metrics-exporter';
import {
  RabbitMqMessageBroker,
  defaultConnectionName,
} from '@infrastructure/queue/rabbitmq.message-broker';
import type { ConnectFn } from '@infrastructure/queue/rabbitmq.message-broker';
import { SystemClock } from '@infrastructure/system/system-clock';
import { TimerWorkSimulator } from '@infrastructure/system/timer-work-simulator';
import { UuidV7IdGenerator } from '@infrastructure/system/uuid-v7-id-generator';

export type Container = {
  readonly config: AppConfig;
  readonly role: ServiceRole;
  readonly logger: Logger;
  readonly startedAt: Date;
  readonly db: Knex;
  readonly broker: RabbitMqMessageBroker;
  readonly metrics: PrometheusMetricsExporter;
  readonly taskRepository: MySqlTaskRepository;
  readonly enqueueTask: EnqueueTaskUseCase;
  readonly processTask: ProcessTaskUseCase;
  readonly getTaskStatus: GetTaskStatusUseCase;
  readonly getTaskStats: GetTaskStatsUseCase;
  readonly getSystemHealth: GetSystemHealthUseCase;
  readonly recordQueueMetrics: RecordQueueMetricsUseCase;
};

export type ContainerOverrides = {
  readonly workSimulator?: WorkSimulator;
  readonly autoscalingPublisher?: AutoscalingMetricsPublisher;
  readonly connectBroker?: ConnectFn;
};

/**
 * Composition root: the only place where concrete adapters are wired to the use cases. Both
 * processes (API and worker) are built from the same container; each uses what it needs.
 */
export const createContainer = async (
  config: AppConfig,
  logger: Logger,
  role: ServiceRole,
  overrides: ContainerOverrides = {},
): Promise<Container> => {
  const clock = new SystemClock();
  const startedAt = clock.now();
  const db = createDatabase(config.database);
  let broker: RabbitMqMessageBroker;
  try {
    broker = await RabbitMqMessageBroker.connect(
      { ...config.rabbitmq, connectionName: defaultConnectionName(role) },
      logger,
      overrides.connectBroker,
    );
  } catch (error: unknown) {
    await db.destroy();
    throw error;
  }

  const metrics = new PrometheusMetricsExporter({ service: role });
  metrics.collectGauge('active_connections', () => [
    { labels: { resource: 'mysql' }, value: openConnections(db) },
    { labels: { resource: 'amqp' }, value: broker.isConnected ? 1 : 0 },
  ]);

  const taskRepository = new MySqlTaskRepository(db);
  const idGenerator = new UuidV7IdGenerator();
  const queue = config.rabbitmq.queue;
  const processors = TaskProcessorRegistry.withSimulatedProcessors(
    overrides.workSimulator ?? new TimerWorkSimulator(config.tasks.simulation),
  );
  const autoscalingPublisher =
    overrides.autoscalingPublisher ??
    (config.metrics.cloudWatch.enabled
      ? CloudWatchAutoscalingMetricsPublisher.create(config.metrics.cloudWatch)
      : new NoopAutoscalingMetricsPublisher());

  return {
    config,
    role,
    logger,
    startedAt,
    db,
    broker,
    metrics,
    taskRepository,
    enqueueTask: new EnqueueTaskUseCase(
      taskRepository,
      broker,
      idGenerator,
      clock,
      metrics,
      logger,
      {
        queue,
      },
    ),
    processTask: new ProcessTaskUseCase(taskRepository, processors, clock, metrics, logger, {
      maxAttempts: config.tasks.maxAttempts,
    }),
    getTaskStatus: new GetTaskStatusUseCase(taskRepository),
    getTaskStats: new GetTaskStatsUseCase(taskRepository, broker, logger, { queue }),
    getSystemHealth: new GetSystemHealthUseCase(
      [
        { name: 'database', check: () => pingDatabase(db) },
        { name: 'rabbitmq', check: () => broker.ping() },
      ],
      clock,
      { service: role, startedAt },
    ),
    recordQueueMetrics: new RecordQueueMetricsUseCase(
      broker,
      metrics,
      autoscalingPublisher,
      clock,
      {
        queues: [queue, config.rabbitmq.deadLetterQueue],
      },
    ),
  };
};
