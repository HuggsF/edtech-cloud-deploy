import { MAX_OUTCOME_LENGTH, Task } from '@domain/entities/task.entity';
import type { TaskSnapshot } from '@domain/entities/task.entity';
import { InvalidTaskError } from '@domain/errors/invalid-task.error';
import { InvalidTaskPayloadError } from '@domain/errors/invalid-task-payload.error';
import { InvalidTaskStatusError } from '@domain/errors/invalid-task-status.error';
import { InvalidTaskTransitionError } from '@domain/errors/invalid-task-transition.error';
import { InvalidTaskTypeError } from '@domain/errors/invalid-task-type.error';
import { TASK_ID, VALID_PAYLOADS, buildTask, must } from '../../../support/fakes';

const CREATED_AT = new Date('2026-01-01T12:00:00.000Z');
const LATER = new Date('2026-01-01T12:00:05.000Z');

const snapshot = (overrides: Partial<TaskSnapshot> = {}): TaskSnapshot => ({
  id: TASK_ID,
  type: 'report_generation',
  payload: VALID_PAYLOADS.report_generation,
  status: 'processing',
  attempts: 1,
  result: null,
  error: null,
  createdAt: CREATED_AT,
  processedAt: null,
  ...overrides,
});

describe('Task', () => {
  describe('create', () => {
    it('creates a pending task with no attempts', () => {
      const task = buildTask('certificate_generation');

      expect(task.id).toBe(TASK_ID);
      expect(task.type.value).toBe('certificate_generation');
      expect(task.status.value).toBe('pending');
      expect(task.attempts).toBe(0);
      expect(task.result).toBeNull();
      expect(task.error).toBeNull();
      expect(task.createdAt).toEqual(CREATED_AT);
      expect(task.processedAt).toBeNull();
      expect(task.payload.getString('studentName')).toBe('Ana Souza');
    });

    it('is immutable', () => {
      const task = buildTask();

      expect(Object.isFrozen(task)).toBe(true);
      expect(() => {
        (task as { attempts: number }).attempts = 5;
      }).toThrow(TypeError);
    });

    it.each(['', '   ', 'x'.repeat(37)])('rejects the id %p', (id) => {
      const result = Task.create({
        id,
        type: 'data_sync',
        payload: VALID_PAYLOADS.data_sync,
        createdAt: CREATED_AT,
      });

      expect(!result.success && result.error).toBeInstanceOf(InvalidTaskError);
    });

    it('rejects an invalid creation date', () => {
      const result = Task.create({
        id: TASK_ID,
        type: 'data_sync',
        payload: VALID_PAYLOADS.data_sync,
        createdAt: new Date('nope'),
      });

      expect(!result.success && result.error.message).toBe('Task creation date is invalid');
    });

    it('rejects an unknown type', () => {
      const result = Task.create({ id: TASK_ID, type: 'sms', payload: {}, createdAt: CREATED_AT });

      expect(!result.success && result.error).toBeInstanceOf(InvalidTaskTypeError);
    });

    it('rejects a payload that does not match the type schema', () => {
      const result = Task.create({
        id: TASK_ID,
        type: 'report_generation',
        payload: VALID_PAYLOADS.email_notification,
        createdAt: CREATED_AT,
      });

      expect(!result.success && result.error).toBeInstanceOf(InvalidTaskPayloadError);
    });
  });

  describe('lifecycle', () => {
    it('pending → processing → completed', () => {
      const pending = buildTask();
      const processing = must(pending.markAsProcessing());
      const completed = must(processing.markAsCompleted('  Email sent  ', LATER));

      expect(processing.status.value).toBe('processing');
      expect(processing.attempts).toBe(1);
      expect(completed.status.value).toBe('completed');
      expect(completed.result).toBe('Email sent');
      expect(completed.error).toBeNull();
      expect(completed.processedAt).toEqual(LATER);
      expect(completed.isTerminal).toBe(true);
      // Transitions return new instances: the original is untouched.
      expect(pending.status.value).toBe('pending');
      expect(processing.result).toBeNull();
    });

    it('processing → failed records the error', () => {
      const failed = must(must(buildTask().markAsProcessing()).markAsFailed('SMTP down', LATER));

      expect(failed.status.value).toBe('failed');
      expect(failed.error).toBe('SMTP down');
      expect(failed.processedAt).toEqual(LATER);
    });

    it('pending → failed when the task could not be enqueued', () => {
      expect(must(buildTask().markAsFailed('not published', LATER)).status.value).toBe('failed');
    });

    it('retries go back to pending, keep the error and count attempts', () => {
      const first = must(buildTask().markAsProcessing());
      const retry = must(first.markForRetry('timeout'));
      const second = must(retry.markAsProcessing());
      const completed = must(second.markAsCompleted('ok', LATER));

      expect(retry.status.value).toBe('pending');
      expect(retry.error).toBe('timeout');
      expect(second.attempts).toBe(2);
      expect(second.error).toBe('timeout');
      expect(completed.error).toBeNull();
    });

    it('a redelivered processing task is picked up again with one more attempt', () => {
      const redelivered = must(must(buildTask().markAsProcessing()).markAsProcessing());

      expect(redelivered.attempts).toBe(2);
    });

    it('knows when attempts are exhausted', () => {
      const twice = must(must(buildTask().markAsProcessing()).markAsProcessing());

      expect(twice.hasExhaustedAttempts(3)).toBe(false);
      expect(twice.hasExhaustedAttempts(2)).toBe(true);
    });

    it.each([
      ['complete a pending task', (task: Task) => task.markAsCompleted('x', LATER)],
      ['retry a pending task', (task: Task) => task.markForRetry('x')],
    ])('cannot %s', (_label, transition) => {
      const result = transition(buildTask());

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeInstanceOf(InvalidTaskTransitionError);
        expect(result.error.from).toBe('pending');
        expect(result.error.taskId).toBe(TASK_ID);
      }
    });

    it('finished tasks are final', () => {
      const completed = must(must(buildTask().markAsProcessing()).markAsCompleted('ok', LATER));

      expect(completed.markAsProcessing().success).toBe(false);
      expect(completed.markAsFailed('x', LATER).success).toBe(false);
      const failed = must(buildTask().markAsFailed('x', LATER));
      expect(failed.markAsProcessing().success).toBe(false);
    });

    it('bounds the stored outcome text', () => {
      const failed = must(
        must(buildTask().markAsProcessing()).markAsFailed('e'.repeat(5000), LATER),
      );

      expect(failed.error).toHaveLength(MAX_OUTCOME_LENGTH);
      expect(failed.error?.endsWith('…')).toBe(true);
    });
  });

  describe('restore', () => {
    it('rehydrates every persisted field', () => {
      const task = must(
        Task.restore(
          snapshot({ status: 'completed', attempts: 2, result: 'done', processedAt: LATER }),
        ),
      );

      expect(task.status.value).toBe('completed');
      expect(task.attempts).toBe(2);
      expect(task.result).toBe('done');
      expect(task.processedAt).toEqual(LATER);
      expect(task.type.value).toBe('report_generation');
    });

    it('rejects an unknown status', () => {
      const result = Task.restore(snapshot({ status: 'archived' }));

      expect(!result.success && result.error).toBeInstanceOf(InvalidTaskStatusError);
    });

    it.each([-1, 1.5])('rejects %p attempts', (attempts) => {
      const result = Task.restore(snapshot({ attempts }));

      expect(!result.success && result.error).toBeInstanceOf(InvalidTaskError);
    });

    it('rejects an invalid processing date', () => {
      const result = Task.restore(snapshot({ processedAt: new Date('nope') }));

      expect(!result.success && result.error.message).toBe('Task processing date is invalid');
    });

    it('rejects a corrupted payload', () => {
      const result = Task.restore(snapshot({ payload: { reportType: 'unknown' } }));

      expect(!result.success && result.error).toBeInstanceOf(InvalidTaskPayloadError);
    });
  });
});
