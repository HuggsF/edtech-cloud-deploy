import awsCaBundle from 'aws-ssl-profiles';
import { knex } from 'knex';
import type { Knex } from 'knex';
import type { DatabaseConfig } from '@infrastructure/config/env';

/** MySQL connection pool (mysql2 driver). Stateless app: every replica has its own small pool. */
export const createDatabase = (config: DatabaseConfig): Knex =>
  knex({
    client: 'mysql2',
    connection: {
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.name,
      charset: 'utf8mb4',
      timezone: 'Z',
      // RDS: TLS verified against the Amazon RDS CA bundle (RDS enforces require_secure_transport).
      ...(config.ssl ? { ssl: awsCaBundle } : {}),
    },
    pool: { min: config.pool.min, max: config.pool.max },
  });

export const pingDatabase = async (db: Knex): Promise<void> => {
  await db.raw('SELECT 1');
};

type PoolStats = { numUsed: () => number; numFree: () => number };

const hasPoolStats = (pool: unknown): pool is PoolStats =>
  typeof pool === 'object' &&
  pool !== null &&
  'numUsed' in pool &&
  'numFree' in pool &&
  typeof pool.numUsed === 'function' &&
  typeof pool.numFree === 'function';

/** Open connections in the pool (in use + idle), for the `active_connections` gauge. */
export const openConnections = (db: Knex): number => {
  const client: unknown = db.client;
  const pool: unknown =
    typeof client === 'object' && client !== null && 'pool' in client ? client.pool : undefined;
  return hasPoolStats(pool) ? pool.numUsed() + pool.numFree() : 0;
};
