import './module-aliases';
import { loadConfig, loadEnvFile } from '@infrastructure/config/env';
import { createDatabase } from '@infrastructure/database/knex';
import { migrateLatest, migrateRollback } from '@infrastructure/database/migrator';
import { createLogger } from '@infrastructure/logging/logger';

/**
 * One-off migration entry point: `node dist/migrate.js [--rollback]`. In AWS the deploy
 * pipeline runs it as a standalone ECS task (same image, same secrets) before rolling out the
 * new services, so schema changes never race between replicas.
 */
const main = async (): Promise<void> => {
  loadEnvFile();
  const config = loadConfig();
  const logger = createLogger({ ...config.log, name: 'edtech-migrate' });
  const db = createDatabase(config.database);
  try {
    const rollback = process.argv.includes('--rollback');
    const names = rollback ? await migrateRollback(db) : await migrateLatest(db);
    logger.info(
      { rollback, migrations: names },
      names.length === 0 ? 'Database already up to date' : 'Migrations done',
    );
  } finally {
    await db.destroy();
  }
};

main().catch((error: unknown) => {
  process.stderr.write(`Migration failed\n${String(error)}\n`);
  process.exit(1);
});
