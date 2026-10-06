import type { Knex } from 'knex';
import { Task } from '@domain/entities/task.entity';
import type { TaskRow } from '@infrastructure/database/mysql-task.repository';
import { MySqlTaskRepository, TASKS_TABLE } from '@infrastructure/database/mysql-task.repository';
import { TASK_ID, VALID_PAYLOADS, buildTask, must } from '../../../support/fakes';

describe('MySqlTaskRepository', () => {
  let insertMock: jest.Mock<Promise<unknown>, [TaskRow]>;
  let firstMock: jest.Mock<Promise<TaskRow | undefined>, []>;
  let updateMock: jest.Mock<Promise<number>, [Partial<TaskRow>]>;
  let groupByMock: jest.Mock<Promise<{ status: string; total: string | number }[]>, [string]>;
  let whereMock: jest.Mock;
  let countMock: jest.Mock;
  let selectMock: jest.Mock;
  let fakeDb: Knex;
  let repository: MySqlTaskRepository;

  beforeEach(() => {
    insertMock = jest.fn<Promise<unknown>, [TaskRow]>().mockResolvedValue([1]);
    firstMock = jest.fn<Promise<TaskRow | undefined>, []>();
    updateMock = jest.fn<Promise<number>, [Partial<TaskRow>]>();
    groupByMock = jest.fn<Promise<{ status: string; total: string | number }[]>, [string]>();

    whereMock = jest.fn().mockReturnValue({
      first: firstMock,
      update: updateMock,
    });

    countMock = jest.fn().mockReturnValue({
      groupBy: groupByMock,
    });

    selectMock = jest.fn().mockReturnValue({
      count: countMock,
    });

    const queryBuilder = jest.fn((table: string) => {
      expect(table).toBe(TASKS_TABLE);
      return {
        insert: insertMock,
        where: whereMock,
        select: selectMock,
      };
    });

    fakeDb = queryBuilder as unknown as Knex;
    repository = new MySqlTaskRepository(fakeDb);
  });

  describe('save', () => {
    it('inserts the serialized task into the database', async () => {
      const task = buildTask('email_notification');

      await repository.save(task);

      expect(insertMock).toHaveBeenCalledTimes(1);
      const inserted = insertMock.mock.calls[0]?.[0];
      expect(inserted?.id).toBe(task.id);
      expect(inserted?.type).toBe('email_notification');
      expect(inserted?.status).toBe('pending');
      expect(inserted?.attempts).toBe(0);
      expect(inserted?.result).toBeNull();
      expect(inserted?.error).toBeNull();
      expect(inserted?.processed_at).toBeNull();
      expect(typeof inserted?.payload).toBe('string');
      expect(JSON.parse(inserted?.payload as string)).toEqual({
        ...VALID_PAYLOADS.email_notification,
        to: 'ana.souza@school.edu',
      });
    });
  });

  describe('findById', () => {
    it('returns null when task row is not found', async () => {
      firstMock.mockResolvedValue(undefined);

      const result = await repository.findById(TASK_ID);

      expect(whereMock).toHaveBeenCalledWith({ id: TASK_ID });
      expect(result).toBeNull();
    });

    it('returns reconstructed Task entity when row is found (with string payload)', async () => {
      const row: TaskRow = {
        id: TASK_ID,
        type: 'email_notification',
        payload: JSON.stringify({
          ...VALID_PAYLOADS.email_notification,
          to: 'ana.souza@school.edu',
        }),
        status: 'pending',
        attempts: 0,
        result: null,
        error: null,
        created_at: new Date('2026-01-01T12:00:00.000Z'),
        processed_at: null,
      };
      firstMock.mockResolvedValue(row);

      const task = await repository.findById(TASK_ID);

      expect(task).toBeInstanceOf(Task);
      expect(task?.id).toBe(TASK_ID);
      expect(task?.type.value).toBe('email_notification');
      expect(task?.payload.toJSON()).toEqual({
        ...VALID_PAYLOADS.email_notification,
        to: 'ana.souza@school.edu',
      });
      expect(task?.processedAt).toBeNull();
    });

    it('returns reconstructed Task entity when payload is already parsed object', async () => {
      const row: TaskRow = {
        id: TASK_ID,
        type: 'report_generation',
        payload: VALID_PAYLOADS.report_generation,
        status: 'completed',
        attempts: 1,
        result: 'Done',
        error: null,
        created_at: new Date('2026-01-01T12:00:00.000Z'),
        processed_at: new Date('2026-01-01T12:00:05.000Z'),
      };
      firstMock.mockResolvedValue(row);

      const task = await repository.findById(TASK_ID);

      expect(task).toBeInstanceOf(Task);
      expect(task?.result).toBe('Done');
      expect(task?.processedAt).toBeInstanceOf(Date);
    });

    it('throws an error if row data fails entity validation', async () => {
      const corruptedRow: TaskRow = {
        id: TASK_ID,
        type: 'invalid_type',
        payload: {},
        status: 'pending',
        attempts: 0,
        result: null,
        error: null,
        created_at: new Date(),
        processed_at: null,
      };
      firstMock.mockResolvedValue(corruptedRow);

      await expect(repository.findById(TASK_ID)).rejects.toThrow(/Corrupted task row/);
    });
  });

  describe('updateStatus', () => {
    it('updates status, attempts, result, error, and processed_at', async () => {
      const task = buildTask('email_notification');
      const processing = must(task.markAsProcessing());
      updateMock.mockResolvedValue(1);

      await repository.updateStatus(processing);

      expect(whereMock).toHaveBeenCalledWith({ id: processing.id });
      expect(updateMock).toHaveBeenCalledTimes(1);
      const updated = updateMock.mock.calls[0]?.[0];
      expect(updated?.status).toBe('processing');
      expect(updated?.attempts).toBe(1);
    });

    it('throws if updated rows count is 0', async () => {
      const task = buildTask('email_notification');
      updateMock.mockResolvedValue(0);

      await expect(repository.updateStatus(task)).rejects.toThrow(`Task ${task.id} does not exist`);
    });
  });

  describe('countByStatus', () => {
    it('returns count for all statuses with defaults to 0', async () => {
      groupByMock.mockResolvedValue([
        { status: 'pending', total: '5' },
        { status: 'completed', total: 12 },
      ]);

      const counts = await repository.countByStatus();

      expect(counts).toEqual({
        pending: 5,
        processing: 0,
        completed: 12,
        failed: 0,
      });
    });
  });
});
