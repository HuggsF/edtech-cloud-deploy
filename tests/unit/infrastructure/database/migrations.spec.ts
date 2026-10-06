import type { Knex } from 'knex';
import * as createTasksMigration from '@infrastructure/database/migrations/20260101000000-create-tasks-table';
import { migrateLatest, migrateRollback } from '@infrastructure/database/migrator';

describe('Database Migrations', () => {
  describe('20260101000000-create-tasks-table', () => {
    it('has the expected migration name', () => {
      expect(createTasksMigration.name).toBe('20260101000000_create_tasks_table');
    });

    it('executes CREATE TABLE statement in up()', async () => {
      const rawMock = jest.fn<Promise<unknown>, [string]>().mockResolvedValue(undefined);
      const fakeKnex = { raw: rawMock } as unknown as Knex;

      await createTasksMigration.up(fakeKnex);

      expect(rawMock).toHaveBeenCalledTimes(1);
      const query = rawMock.mock.calls[0]?.[0] ?? '';
      expect(query).toContain('CREATE TABLE tasks');
      expect(query).toContain('email_notification');
      expect(query).toContain('certificate_generation');
    });

    it('executes dropTableIfExists in down()', async () => {
      const dropTableIfExistsMock = jest
        .fn<Promise<unknown>, [string]>()
        .mockResolvedValue(undefined);
      const fakeKnex = {
        schema: { dropTableIfExists: dropTableIfExistsMock },
      } as unknown as Knex;

      await createTasksMigration.down(fakeKnex);

      expect(dropTableIfExistsMock).toHaveBeenCalledWith('tasks');
    });
  });

  describe('Migrator', () => {
    it('executes migrateLatest and returns applied migration names', async () => {
      const latestMock = jest
        .fn<Promise<unknown>, [Knex.MigratorConfig]>()
        .mockResolvedValue([1, ['20260101000000_create_tasks_table']]);
      const fakeKnex = {
        migrate: { latest: latestMock },
      } as unknown as Knex;

      const applied = await migrateLatest(fakeKnex);

      expect(latestMock).toHaveBeenCalledTimes(1);
      expect(applied).toEqual(['20260101000000_create_tasks_table']);
    });

    it('handles empty results in migrateLatest', async () => {
      const latestMock = jest
        .fn<Promise<unknown>, [Knex.MigratorConfig]>()
        .mockResolvedValue([0, []]);
      const fakeKnex = {
        migrate: { latest: latestMock },
      } as unknown as Knex;

      const applied = await migrateLatest(fakeKnex);
      expect(applied).toEqual([]);
    });

    it('executes migrateRollback and returns rolled back migration names', async () => {
      const rollbackMock = jest
        .fn<Promise<unknown>, [Knex.MigratorConfig]>()
        .mockResolvedValue([1, ['20260101000000_create_tasks_table']]);
      const fakeKnex = {
        migrate: { rollback: rollbackMock },
      } as unknown as Knex;

      const rolledBack = await migrateRollback(fakeKnex);

      expect(rollbackMock).toHaveBeenCalledTimes(1);
      expect(rolledBack).toEqual(['20260101000000_create_tasks_table']);
    });
  });
});
