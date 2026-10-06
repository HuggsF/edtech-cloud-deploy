import { TaskProcessorRegistry } from '@application/services/processors/task-processor.registry';
import { TaskType } from '@domain/value-objects/task-type.value-object';
import { ScriptedWorkSimulator, TASK_ID, buildTask } from '../../../support/fakes';

const registry = (simulator = new ScriptedWorkSimulator()): TaskProcessorRegistry =>
  TaskProcessorRegistry.withSimulatedProcessors(simulator);

const resultOf = async (task: ReturnType<typeof buildTask>): Promise<string> => {
  const processor = registry().forType(task.type);
  const result = await processor!.process(task);
  if (!result.success) {
    throw result.error;
  }
  return result.data;
};

describe('Task processors', () => {
  it('has one processor per task type', () => {
    expect(registry().missingTypes).toEqual([]);
    expect(new TaskProcessorRegistry([]).missingTypes).toHaveLength(4);
    expect(new TaskProcessorRegistry([]).forType(TaskType.of('data_sync'))).toBeNull();
  });

  it('email_notification describes the delivery', async () => {
    expect(await resultOf(buildTask('email_notification'))).toBe(
      'Email "welcome" delivered to ana.souza@school.edu',
    );
  });

  it('report_generation returns the report location', async () => {
    expect(await resultOf(buildTask('report_generation'))).toBe(
      'Report generated: reports/MATH-101/grade_summary-0000000001.pdf',
    );
  });

  it('data_sync describes the synchronisation, with defaults for optional fields', async () => {
    expect(await resultOf(buildTask('data_sync'))).toBe(
      'Synchronised students from SIS since 2026-01-01 in batches of 200',
    );
    expect(
      await resultOf(buildTask('data_sync', { payload: { source: 'lms', entity: 'grades' } })),
    ).toBe('Synchronised grades from LMS since the beginning in batches of 500');
  });

  it('certificate_generation issues a stable certificate number', async () => {
    expect(await resultOf(buildTask('certificate_generation', { id: TASK_ID }))).toBe(
      'Certificate CERT-0000000001 issued to Ana Souza for course MATH-101',
    );
  });

  it('reports simulated I/O failures as retryable', async () => {
    const simulator = new ScriptedWorkSimulator([
      { ok: false, durationMs: 3, reason: 'SIS API answered 503' },
    ]);
    const task = buildTask('data_sync');

    const result = await registry(simulator).forType(task.type)!.process(task);

    expect(result.success).toBe(false);
    expect(!result.success && result.error.retryable).toBe(true);
    expect(!result.success && result.error.message).toBe('SIS API answered 503');
  });

  it('reports a hard bounce as permanent, without doing the work', async () => {
    const simulator = new ScriptedWorkSimulator();
    const task = buildTask('email_notification', {
      payload: { to: 'nobody@bounce.test', template: 'welcome', subject: 'Hi' },
    });

    const result = await registry(simulator).forType(task.type)!.process(task);

    expect(!result.success && result.error.retryable).toBe(false);
    expect(simulator.calls).toEqual([]);
  });
});
