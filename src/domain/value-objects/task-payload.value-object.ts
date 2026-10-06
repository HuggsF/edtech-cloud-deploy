import { InvalidTaskPayloadError } from '@domain/errors/invalid-task-payload.error';
import { fail, ok } from '@domain/shared/result';
import type { Result } from '@domain/shared/result';
import { TASK_PAYLOAD_SCHEMAS } from './task-payload.schemas';
import type { FieldRule } from './task-payload.schemas';
import type { TaskType } from './task-type.value-object';

export type TaskPayloadValue = string | number;
export type TaskPayloadData = Readonly<Record<string, TaskPayloadValue>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isCalendarDate = (value: string): boolean => {
  const match = DATE_PATTERN.exec(value);
  if (match === null) {
    return false;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
};

type FieldCheck = { readonly value: TaskPayloadValue } | { readonly issue: string };

const checkText = (field: string, raw: unknown, rule: FieldRule & { kind: 'text' }): FieldCheck => {
  if (typeof raw !== 'string') {
    return { issue: `"${field}" must be a string` };
  }
  const value = raw.trim();
  if (value.length < rule.min || value.length > rule.max) {
    return { issue: `"${field}" must be between ${rule.min} and ${rule.max} characters` };
  }
  if (rule.pattern !== undefined && !rule.pattern.test(value)) {
    return { issue: `"${field}" has an invalid format (${rule.patternHint ?? 'see the schema'})` };
  }
  return { value };
};

const checkField = (field: string, raw: unknown, rule: FieldRule): FieldCheck => {
  switch (rule.kind) {
    case 'text':
      return checkText(field, raw, rule);
    case 'email': {
      const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
      return value.length <= 254 && EMAIL_PATTERN.test(value)
        ? { value }
        : { issue: `"${field}" must be a valid email address` };
    }
    case 'enum':
      return typeof raw === 'string' && rule.values.includes(raw)
        ? { value: raw }
        : { issue: `"${field}" must be one of: ${rule.values.join(', ')}` };
    case 'date':
      return typeof raw === 'string' && isCalendarDate(raw)
        ? { value: raw }
        : { issue: `"${field}" must be a calendar date (YYYY-MM-DD)` };
    case 'integer':
      return typeof raw === 'number' && Number.isInteger(raw) && raw >= rule.min && raw <= rule.max
        ? { value: raw }
        : { issue: `"${field}" must be an integer between ${rule.min} and ${rule.max}` };
  }
};

/**
 * Immutable, validated payload of a task. The schema depends on the task type (see
 * task-payload.schemas.ts); unknown fields are rejected so garbage never reaches the queue.
 */
export class TaskPayload {
  private constructor(private readonly data: TaskPayloadData) {}

  static create(type: TaskType, raw: unknown): Result<TaskPayload, InvalidTaskPayloadError> {
    if (!isPlainObject(raw)) {
      return fail(new InvalidTaskPayloadError(type.value, ['payload must be a JSON object']));
    }
    const schema = TASK_PAYLOAD_SCHEMAS[type.value];
    const issues: string[] = [];
    const data: Record<string, TaskPayloadValue> = {};

    for (const [field, value] of Object.entries(raw)) {
      const known = Object.hasOwn(schema.required, field) || Object.hasOwn(schema.optional, field);
      if (!known && value !== undefined) {
        issues.push(`"${field}" is not allowed`);
      }
    }
    const rules: [string, FieldRule, boolean][] = [
      ...Object.entries(schema.required).map(([f, r]): [string, FieldRule, boolean] => [
        f,
        r,
        true,
      ]),
      ...Object.entries(schema.optional).map(([f, r]): [string, FieldRule, boolean] => [
        f,
        r,
        false,
      ]),
    ];
    for (const [field, rule, required] of rules) {
      const value = raw[field];
      if (value === undefined || value === null) {
        if (required) {
          issues.push(`"${field}" is required`);
        }
        continue;
      }
      const check = checkField(field, value, rule);
      if ('issue' in check) {
        issues.push(check.issue);
      } else {
        data[field] = check.value;
      }
    }

    if (issues.length > 0) {
      return fail(new InvalidTaskPayloadError(type.value, issues));
    }
    return ok(new TaskPayload(Object.freeze(data)));
  }

  getString(field: string): string | undefined {
    const value = this.data[field];
    return typeof value === 'string' ? value : undefined;
  }

  getNumber(field: string): number | undefined {
    const value = this.data[field];
    return typeof value === 'number' ? value : undefined;
  }

  /** A defensive copy: callers cannot mutate the payload held by a Task. */
  toJSON(): TaskPayloadData {
    return { ...this.data };
  }
}
