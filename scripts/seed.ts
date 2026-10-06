import { loadConfig, loadEnvFile } from '@infrastructure/config/env';
import { createDatabase } from '@infrastructure/database/knex';
import { MySqlTaskRepository } from '@infrastructure/database/mysql-task.repository';
import { createLogger } from '@infrastructure/logging/logger';
import { RabbitMqMessageBroker } from '@infrastructure/queue/rabbitmq.message-broker';
import { SystemClock } from '@infrastructure/system/system-clock';
import { UuidV7IdGenerator } from '@infrastructure/system/uuid-v7-id-generator';
import { Task } from '@domain/entities/task.entity';
import type { TaskTypeValue } from '@domain/value-objects/task-type.value-object';
import { encodeTaskMessage } from '@application/services/task-message.codec';

const SEED_TASKS: readonly {
  readonly type: TaskTypeValue;
  readonly payload: Record<string, unknown>;
}[] = [
  {
    type: 'email_notification',
    payload: {
      to: 'student1@edtech.org',
      template: 'welcome',
      subject: 'Bem-vindo ao Ambiente Virtual de Aprendizagem!',
    },
  },
  {
    type: 'email_notification',
    payload: {
      to: 'instructor@edtech.org',
      template: 'course_published',
      subject: 'Seu curso foi publicado com sucesso',
    },
  },
  {
    type: 'report_generation',
    payload: {
      reportType: 'grade_summary',
      courseId: 'ENG-SOFTWARE-301',
      format: 'pdf',
    },
  },
  {
    type: 'data_sync',
    payload: {
      source: 'moodle_sis',
      entity: 'students',
      since: '2026-01-01',
      batchSize: 150,
    },
  },
  {
    type: 'certificate_generation',
    payload: {
      studentId: 'STU-9821',
      studentName: 'Mariana Silva',
      courseId: 'CLOUD-ARCH-500',
    },
  },
];

export const runSeed = async (): Promise<void> => {
  loadEnvFile();
  const config = loadConfig();
  const logger = createLogger({ ...config.log, name: 'edtech-seed' });
  const db = createDatabase(config.database);
  const repository = new MySqlTaskRepository(db);
  const clock = new SystemClock();
  const idGen = new UuidV7IdGenerator();

  let broker: RabbitMqMessageBroker | null = null;
  try {
    broker = await RabbitMqMessageBroker.connect(
      { ...config.rabbitmq, connectionName: 'edtech-seed' },
      logger,
    );
  } catch (err: unknown) {
    logger.warn(
      { err },
      'RabbitMQ unreachable during seed; inserting tasks directly into DB only.',
    );
  }

  try {
    logger.info({ count: SEED_TASKS.length }, 'Seeding database and queue with sample tasks...');
    let seededCount = 0;

    for (const spec of SEED_TASKS) {
      const id = idGen.generate();
      const createdAt = clock.now();
      const createResult = Task.create({
        id,
        type: spec.type,
        payload: spec.payload,
        createdAt,
      });

      if (!createResult.success) {
        logger.error(
          { error: createResult.error },
          'Failed to create domain Task entity during seed',
        );
        continue;
      }

      const task = createResult.data;
      await repository.save(task);

      if (broker?.isConnected) {
        const message = encodeTaskMessage({
          taskId: task.id,
          type: task.type.value,
          enqueuedAt: createdAt.toISOString(),
        });
        await broker.publish(config.rabbitmq.queue, message);
      }

      seededCount += 1;
      logger.info({ taskId: task.id, type: task.type.value }, 'Task seeded');
    }

    const counts = await repository.countByStatus();
    logger.info({ seededCount, totalByStatus: counts }, 'Database seeding completed successfully.');
  } finally {
    if (broker) {
      await broker.close();
    }
    await db.destroy();
  }
};

void runSeed().catch((error: unknown) => {
  process.stderr.write(`Seed failed: ${String(error)}\n`);
  process.exit(1);
});
