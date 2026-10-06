import type { TaskMessage } from '@application/dtos/task-message.dto';
import { InvalidTaskMessageError } from '@application/errors/invalid-task-message.error';
import { fail, ok } from '@domain/shared/result';
import type { Result } from '@domain/shared/result';
import { TaskType } from '@domain/value-objects/task-type.value-object';

const MAX_MESSAGE_BYTES = 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export const encodeTaskMessage = (message: TaskMessage): Uint8Array =>
  encoder.encode(JSON.stringify(message));

const parse = (content: Uint8Array): unknown => {
  try {
    return JSON.parse(decoder.decode(content));
  } catch {
    return undefined;
  }
};

/** Validates an incoming message. Anything else is a poison message (dead-lettered). */
export const decodeTaskMessage = (
  content: Uint8Array,
): Result<TaskMessage, InvalidTaskMessageError> => {
  if (content.byteLength === 0 || content.byteLength > MAX_MESSAGE_BYTES) {
    return fail(new InvalidTaskMessageError(`size must be 1 to ${MAX_MESSAGE_BYTES} bytes`));
  }
  const body = parse(content);
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return fail(new InvalidTaskMessageError('body is not a JSON object'));
  }
  const { taskId, type, enqueuedAt } = body as Record<string, unknown>;
  if (typeof taskId !== 'string' || taskId.length === 0 || taskId.length > 36) {
    return fail(new InvalidTaskMessageError('"taskId" must be a string of 1 to 36 characters'));
  }
  const taskType = TaskType.create(typeof type === 'string' ? type : '');
  if (!taskType.success) {
    return fail(new InvalidTaskMessageError('"type" is not a known task type'));
  }
  if (typeof enqueuedAt !== 'string' || Number.isNaN(Date.parse(enqueuedAt))) {
    return fail(new InvalidTaskMessageError('"enqueuedAt" must be an ISO date'));
  }
  return ok({ taskId, type: taskType.data.value, enqueuedAt });
};
