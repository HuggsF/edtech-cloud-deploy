import type { TaskTypeValue } from './task-type.value-object';

export type FieldRule =
  | {
      readonly kind: 'text';
      readonly min: number;
      readonly max: number;
      readonly pattern?: RegExp;
      readonly patternHint?: string;
    }
  | { readonly kind: 'email' }
  | { readonly kind: 'enum'; readonly values: readonly string[] }
  | { readonly kind: 'date' }
  | { readonly kind: 'integer'; readonly min: number; readonly max: number };

export type PayloadSchema = {
  readonly required: Readonly<Record<string, FieldRule>>;
  readonly optional: Readonly<Record<string, FieldRule>>;
};

const IDENTIFIER: FieldRule = {
  kind: 'text',
  min: 1,
  max: 64,
  pattern: /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/,
  patternHint: 'letters, digits and _ . : - only',
};

/**
 * Type-specific payload contracts. Plain data + plain code: the Domain stays free of validation
 * libraries (zod is used at the edges — HTTP input and environment variables).
 * Every field is bounded and unknown fields are rejected, so a payload is small by construction
 * (well under 1 KB serialized).
 */
export const TASK_PAYLOAD_SCHEMAS: Readonly<Record<TaskTypeValue, PayloadSchema>> = {
  email_notification: {
    required: {
      to: { kind: 'email' },
      template: {
        kind: 'enum',
        values: ['welcome', 'enrollment_confirmation', 'grade_published', 'password_reset'],
      },
      subject: { kind: 'text', min: 1, max: 200 },
    },
    optional: {
      locale: {
        kind: 'text',
        min: 2,
        max: 5,
        pattern: /^[a-z]{2}(-[A-Z]{2})?$/,
        patternHint: 'e.g. "pt" or "pt-BR"',
      },
    },
  },
  report_generation: {
    required: {
      reportType: { kind: 'enum', values: ['course_progress', 'grade_summary', 'attendance'] },
      courseId: IDENTIFIER,
      format: { kind: 'enum', values: ['pdf', 'csv'] },
    },
    optional: {
      requestedBy: IDENTIFIER,
    },
  },
  data_sync: {
    required: {
      source: { kind: 'enum', values: ['lms', 'sis', 'crm'] },
      entity: { kind: 'enum', values: ['students', 'courses', 'enrollments', 'grades'] },
    },
    optional: {
      since: { kind: 'date' },
      batchSize: { kind: 'integer', min: 1, max: 10_000 },
    },
  },
  certificate_generation: {
    required: {
      studentId: IDENTIFIER,
      studentName: { kind: 'text', min: 2, max: 120 },
      courseId: IDENTIFIER,
    },
    optional: {
      completedAt: { kind: 'date' },
    },
  },
};
