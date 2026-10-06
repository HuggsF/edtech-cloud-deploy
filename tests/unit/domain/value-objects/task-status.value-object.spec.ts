import { InvalidTaskStatusError } from '@domain/errors/invalid-task-status.error';
import { TASK_STATUSES, TaskStatus } from '@domain/value-objects/task-status.value-object';
import type { TaskStatusValue } from '@domain/value-objects/task-status.value-object';

describe('TaskStatus', () => {
  it.each(TASK_STATUSES)('parses %s into a shared instance', (value) => {
    const result = TaskStatus.create(value);

    expect(result.success && result.data).toBe(TaskStatus.of(value));
    expect(result.success && result.data.toString()).toBe(value);
  });

  it('rejects unknown statuses', () => {
    const result = TaskStatus.create('done');

    expect(result.success).toBe(false);
    expect(!result.success && result.error).toBeInstanceOf(InvalidTaskStatusError);
  });

  it('marks completed and failed as terminal', () => {
    expect(TaskStatus.COMPLETED.isTerminal).toBe(true);
    expect(TaskStatus.FAILED.isTerminal).toBe(true);
    expect(TaskStatus.PENDING.isTerminal).toBe(false);
    expect(TaskStatus.PROCESSING.isTerminal).toBe(false);
  });

  const allowed: [TaskStatusValue, TaskStatusValue][] = [
    ['pending', 'processing'],
    ['pending', 'failed'],
    ['processing', 'processing'],
    ['processing', 'pending'],
    ['processing', 'completed'],
    ['processing', 'failed'],
  ];

  it.each(TASK_STATUSES.flatMap((from) => TASK_STATUSES.map((to) => [from, to] as const)))(
    '%s → %s follows the lifecycle',
    (from, to) => {
      const expected = allowed.some(([a, b]) => a === from && b === to);

      expect(TaskStatus.of(from).canTransitionTo(TaskStatus.of(to))).toBe(expected);
    },
  );

  it('compares by value', () => {
    expect(TaskStatus.PENDING.equals(TaskStatus.of('pending'))).toBe(true);
    expect(TaskStatus.PENDING.equals(TaskStatus.FAILED)).toBe(false);
  });
});
