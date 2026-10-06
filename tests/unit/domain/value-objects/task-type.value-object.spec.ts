import { InvalidTaskTypeError } from '@domain/errors/invalid-task-type.error';
import { TASK_TYPES, TaskType } from '@domain/value-objects/task-type.value-object';

describe('TaskType', () => {
  it.each(TASK_TYPES)('accepts %s', (value) => {
    const result = TaskType.create(value);

    expect(result.success).toBe(true);
    expect(result.success && result.data.value).toBe(value);
  });

  it('trims surrounding whitespace', () => {
    const result = TaskType.create('  data_sync ');

    expect(result.success && result.data.toString()).toBe('data_sync');
  });

  it.each(['', 'EMAIL_NOTIFICATION', 'sms', 'report'])('rejects %p', (value) => {
    const result = TaskType.create(value);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(InvalidTaskTypeError);
      expect(result.error.code).toBe('INVALID_TASK_TYPE');
      expect(result.error.allowed).toEqual(TASK_TYPES);
      expect(result.error.message).toContain(`"${value}"`);
    }
  });

  it('compares by value', () => {
    expect(TaskType.of('data_sync').equals(TaskType.of('data_sync'))).toBe(true);
    expect(TaskType.of('data_sync').equals(TaskType.of('report_generation'))).toBe(false);
  });
});
