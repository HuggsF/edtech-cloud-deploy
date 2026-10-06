import { InvalidTaskMessageError } from '@application/errors/invalid-task-message.error';
import { decodeTaskMessage, encodeTaskMessage } from '@application/services/task-message.codec';
import { TASK_ID, encodeJson } from '../../../support/fakes';

const message = {
  taskId: TASK_ID,
  type: 'data_sync',
  enqueuedAt: '2026-01-01T12:00:00.000Z',
} as const;

describe('task message codec', () => {
  it('round-trips a message as compact JSON', () => {
    const bytes = encodeTaskMessage(message);

    expect(new TextDecoder().decode(bytes)).toBe(JSON.stringify(message));
    expect(decodeTaskMessage(bytes)).toEqual({ success: true, data: message });
  });

  it.each([
    ['an empty body', new Uint8Array(0), 'size must be 1 to 1024 bytes'],
    ['an oversized body', new Uint8Array(2048).fill(32), 'size must be 1 to 1024 bytes'],
    ['invalid UTF-8', new Uint8Array([0xff, 0xfe, 0xfd]), 'body is not a JSON object'],
    ['malformed JSON', new TextEncoder().encode('{"taskId":'), 'body is not a JSON object'],
    ['a JSON array', encodeJson([message]), 'body is not a JSON object'],
    [
      'a missing task id',
      encodeJson({ ...message, taskId: '' }),
      '"taskId" must be a string of 1 to 36 characters',
    ],
    ['an unknown type', encodeJson({ ...message, type: 'sms' }), '"type" is not a known task type'],
    ['a non-string type', encodeJson({ ...message, type: 7 }), '"type" is not a known task type'],
    [
      'a bad date',
      encodeJson({ ...message, enqueuedAt: 'yesterday' }),
      '"enqueuedAt" must be an ISO date',
    ],
  ])('rejects %s as a poison message', (_label, content, reason) => {
    const result = decodeTaskMessage(content);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(InvalidTaskMessageError);
      expect(result.error.message).toBe(`Invalid task message: ${reason}`);
    }
  });
});
