import type { Knex } from 'knex';
import type { DatabaseConfig } from '@infrastructure/config/env';
import { createDatabase, openConnections, pingDatabase } from '@infrastructure/database/knex';

describe('Knex Database Adapter', () => {
  const baseConfig: DatabaseConfig = {
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: 'password',
    name: 'edtech_test',
    ssl: false,
    pool: { min: 2, max: 10 },
    migrateOnStart: false,
  };

  type KnexWithConfig = {
    client: {
      config: {
        client: string;
        pool: { min: number; max: number };
        connection: Record<string, unknown>;
      };
    };
  };

  it('creates a knex instance configured with mysql2 and connection settings', () => {
    const db = createDatabase(baseConfig);
    expect(db).toBeDefined();
    const config = (db as unknown as KnexWithConfig).client.config;
    expect(config.client).toBe('mysql2');
    expect(config.pool).toEqual({ min: 2, max: 10 });
    void db.destroy();
  });

  it('configures ssl when ssl is enabled', () => {
    const db = createDatabase({ ...baseConfig, ssl: true });
    expect(db).toBeDefined();
    const config = (db as unknown as KnexWithConfig).client.config;
    expect(config.connection).toHaveProperty('ssl');
    void db.destroy();
  });

  it('pingDatabase executes SELECT 1', async () => {
    const rawMock = jest.fn<Promise<unknown>, [string]>().mockResolvedValue(undefined);
    const fakeDb = { raw: rawMock } as unknown as Knex;

    await pingDatabase(fakeDb);

    expect(rawMock).toHaveBeenCalledWith('SELECT 1');
  });

  it('openConnections returns sum of numUsed and numFree when pool stats exist', () => {
    const fakeDb = {
      client: {
        pool: {
          numUsed: (): number => 3,
          numFree: (): number => 4,
        },
      },
    } as unknown as Knex;

    expect(openConnections(fakeDb)).toBe(7);
  });

  it('openConnections returns 0 when pool stats are missing or invalid', () => {
    const fakeDbWithoutPool = { client: {} } as unknown as Knex;
    expect(openConnections(fakeDbWithoutPool)).toBe(0);

    const fakeDbNull = { client: null } as unknown as Knex;
    expect(openConnections(fakeDbNull)).toBe(0);
  });
});
