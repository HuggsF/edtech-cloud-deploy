import type { ApplicationError } from '@application/errors/application.error';
import type { DomainError } from '@domain/errors/domain.error';
import { InvalidTaskPayloadError } from '@domain/errors/invalid-task-payload.error';
import { InvalidTaskTypeError } from '@domain/errors/invalid-task-type.error';
import { HttpError } from './http-error';

const RETRY_AFTER_SECONDS = '5';

const STATUS_BY_CODE: ReadonlyMap<string, number> = new Map([
  ['INVALID_TASK', 422],
  ['INVALID_TASK_TYPE', 422],
  ['INVALID_TASK_PAYLOAD', 422],
  ['TASK_NOT_FOUND', 404],
]);

const detailsOf = (error: ApplicationError | DomainError): unknown => {
  if (error instanceof InvalidTaskPayloadError) {
    return error.issues;
  }
  if (error instanceof InvalidTaskTypeError) {
    return { allowed: error.allowed };
  }
  return undefined;
};

/** Translates use-case failures (Result errors) into HTTP semantics. */
export const toHttpError = (error: ApplicationError | DomainError): HttpError => {
  if (error.code === 'TASK_ENQUEUE_FAILED') {
    return new HttpError(503, error.code, error.message, undefined, {
      'Retry-After': RETRY_AFTER_SECONDS,
    });
  }
  const status = STATUS_BY_CODE.get(error.code);
  return status === undefined
    ? new HttpError(500, 'INTERNAL_ERROR', 'Internal server error')
    : new HttpError(status, error.code, error.message, detailsOf(error));
};
