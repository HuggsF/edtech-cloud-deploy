import { InvalidTaskPayloadError } from '@domain/errors/invalid-task-payload.error';
import { TaskPayload } from '@domain/value-objects/task-payload.value-object';
import { TASK_TYPES, TaskType } from '@domain/value-objects/task-type.value-object';
import type { TaskTypeValue } from '@domain/value-objects/task-type.value-object';
import { VALID_PAYLOADS } from '../../../support/fakes';

const create = (type: TaskTypeValue, raw: unknown): ReturnType<typeof TaskPayload.create> =>
  TaskPayload.create(TaskType.of(type), raw);

const issuesOf = (type: TaskTypeValue, raw: unknown): readonly string[] => {
  const result = create(type, raw);
  if (result.success) {
    throw new Error('expected a validation failure');
  }
  expect(result.error).toBeInstanceOf(InvalidTaskPayloadError);
  expect(result.error.taskType).toBe(type);
  return result.error.issues;
};

describe('TaskPayload', () => {
  it.each(TASK_TYPES)('accepts a valid %s payload', (type) => {
    expect(create(type, VALID_PAYLOADS[type]).success).toBe(true);
  });

  it('normalises values: trimmed text, lower-cased email', () => {
    const result = create('email_notification', {
      to: '  Ana.Souza@School.EDU ',
      template: 'welcome',
      subject: '  Hello  ',
    });

    expect(result.success && result.data.toJSON()).toEqual({
      to: 'ana.souza@school.edu',
      template: 'welcome',
      subject: 'Hello',
    });
  });

  it.each([null, 'text', 42, ['a'], undefined])('rejects a non-object payload (%p)', (raw) => {
    expect(issuesOf('data_sync', raw)).toEqual(['payload must be a JSON object']);
  });

  it('collects every issue at once: missing, unknown and invalid fields', () => {
    const issues = issuesOf('email_notification', {
      to: 'not-an-email',
      subject: '',
      priority: 'high',
    });

    expect(issues).toEqual([
      '"priority" is not allowed',
      '"to" must be a valid email address',
      '"template" is required',
      '"subject" must be between 1 and 200 characters',
    ]);
  });

  it('does not treat inherited property names as allowed fields', () => {
    expect(issuesOf('data_sync', { ...VALID_PAYLOADS.data_sync, toString: 'x' })).toEqual([
      '"toString" is not allowed',
    ]);
  });

  it('validates enums', () => {
    expect(
      issuesOf('report_generation', { ...VALID_PAYLOADS.report_generation, format: 'xls' }),
    ).toEqual(['"format" must be one of: pdf, csv']);
  });

  it('validates text patterns and types', () => {
    expect(
      issuesOf('certificate_generation', {
        studentId: 'STU 42',
        studentName: 42,
        courseId: 'MATH-101',
      }),
    ).toEqual([
      '"studentId" has an invalid format (letters, digits and _ . : - only)',
      '"studentName" must be a string',
    ]);
    expect(
      issuesOf('email_notification', { ...VALID_PAYLOADS.email_notification, locale: 'pt_BR' }),
    ).toEqual(['"locale" has an invalid format (e.g. "pt" or "pt-BR")']);
  });

  it('accepts optional fields when valid and treats null as absent', () => {
    const result = create('email_notification', {
      ...VALID_PAYLOADS.email_notification,
      locale: 'pt-BR',
      extra: undefined,
    });

    expect(result.success && result.data.getString('locale')).toBe('pt-BR');
    expect(create('data_sync', { source: 'lms', entity: 'grades', since: null }).success).toBe(
      true,
    );
  });

  it.each(['2026-02-30', '2026-13-01', '01/02/2026', 20260101])(
    'rejects %p as a calendar date',
    (since) => {
      expect(issuesOf('data_sync', { source: 'lms', entity: 'grades', since })).toEqual([
        '"since" must be a calendar date (YYYY-MM-DD)',
      ]);
    },
  );

  it.each([0, 10_001, 1.5, '10'])('rejects %p as an integer batch size', (batchSize) => {
    expect(issuesOf('data_sync', { source: 'lms', entity: 'grades', batchSize })).toEqual([
      '"batchSize" must be an integer between 1 and 10000',
    ]);
  });

  it('exposes typed accessors and a defensive copy', () => {
    const result = create('data_sync', VALID_PAYLOADS.data_sync);
    if (!result.success) {
      throw result.error;
    }
    const payload = result.data;

    expect(payload.getString('source')).toBe('sis');
    expect(payload.getNumber('batchSize')).toBe(200);
    expect(payload.getString('batchSize')).toBeUndefined();
    expect(payload.getNumber('source')).toBeUndefined();

    const copy = payload.toJSON() as Record<string, unknown>;
    copy.source = 'crm';
    expect(payload.getString('source')).toBe('sis');
  });
});
