import request from 'supertest';
import type { HealthOutput } from '@application/dtos/health.dto';
import type { EnqueueTaskOutput, TaskOutput, TaskStatsOutput } from '@application/dtos/task.dto';
import { TaskEnqueueFailedError } from '@application/errors/task-enqueue-failed.error';
import { TaskNotFoundError } from '@application/errors/task-not-found.error';
import { UnexpectedError } from '@application/errors/unexpected.error';
import type { EnqueueTaskUseCase } from '@application/use-cases/enqueue-task.use-case';
import type { GetSystemHealthUseCase } from '@application/use-cases/get-system-health.use-case';
import type { GetTaskStatsUseCase } from '@application/use-cases/get-task-stats.use-case';
import type { GetTaskStatusUseCase } from '@application/use-cases/get-task-status.use-case';
import { InvalidTaskPayloadError } from '@domain/errors/invalid-task-payload.error';
import { InvalidTaskTypeError } from '@domain/errors/invalid-task-type.error';
import { fail, ok } from '@domain/shared/result';
import { TASK_TYPES } from '@domain/value-objects/task-type.value-object';
import { createHttpApp } from '@presentation/http/app';
import { HealthController } from '@presentation/http/controllers/health.controller';
import { MetricsController } from '@presentation/http/controllers/metrics.controller';
import { TaskController } from '@presentation/http/controllers/task.controller';
import type { ErrorResponseBody } from '@presentation/http/errors/http-error';
import { RecordingMetrics, TASK_ID, VALID_PAYLOADS, createLoggerMock } from '../../support/fakes';

type Mocked<F extends (...args: never[]) => unknown> = jest.Mock<ReturnType<F>, Parameters<F>>;

const enqueued: EnqueueTaskOutput = {
  taskId: TASK_ID,
  type: 'data_sync',
  status: 'pending',
  createdAt: '2026-01-01T12:00:00.000Z',
};

const taskOutput: TaskOutput = {
  id: TASK_ID,
  type: 'data_sync',
  status: 'completed',
  payload: { source: 'sis', entity: 'students' },
  attempts: 1,
  result: 'Synchronised',
  error: null,
  createdAt: '2026-01-01T12:00:00.000Z',
  processedAt: '2026-01-01T12:00:01.000Z',
};

const stats: TaskStatsOutput = {
  byStatus: { pending: 3, processing: 1, completed: 10, failed: 0 },
  total: 14,
  queue: { name: 'edtech.tasks', depth: 3 },
};

const healthy: HealthOutput = {
  status: 'ok',
  service: 'api',
  uptimeSeconds: 12,
  checks: { database: 'up', rabbitmq: 'up' },
};

const errorOf = (response: { body: unknown }): ErrorResponseBody['error'] =>
  (response.body as ErrorResponseBody).error;

describe('HTTP API', () => {
  let enqueue: Mocked<EnqueueTaskUseCase['execute']>;
  let status: Mocked<GetTaskStatusUseCase['execute']>;
  let getStats: Mocked<GetTaskStatsUseCase['execute']>;
  let health: Mocked<GetSystemHealthUseCase['execute']>;
  let accepting: boolean;
  let app: ReturnType<typeof createHttpApp>;

  beforeEach(() => {
    enqueue = jest
      .fn<ReturnType<EnqueueTaskUseCase['execute']>, Parameters<EnqueueTaskUseCase['execute']>>()
      .mockResolvedValue(ok(enqueued));
    status = jest
      .fn<
        ReturnType<GetTaskStatusUseCase['execute']>,
        Parameters<GetTaskStatusUseCase['execute']>
      >()
      .mockResolvedValue(ok(taskOutput));
    getStats = jest
      .fn<ReturnType<GetTaskStatsUseCase['execute']>, []>()
      .mockResolvedValue(ok(stats));
    health = jest
      .fn<ReturnType<GetSystemHealthUseCase['execute']>, []>()
      .mockResolvedValue(ok(healthy));
    accepting = true;
    app = createHttpApp({
      logger: createLoggerMock(),
      healthController: new HealthController({ execute: health }, () => accepting),
      metricsController: new MetricsController(new RecordingMetrics()),
      taskController: new TaskController(
        { execute: enqueue },
        { execute: status },
        { execute: getStats },
      ),
    });
  });

  describe('POST /api/tasks', () => {
    it('answers 202 Accepted with the task id and where to poll its status', async () => {
      const response = await request(app)
        .post('/api/tasks')
        .send({ type: 'data_sync', payload: VALID_PAYLOADS.data_sync });

      expect(response.status).toBe(202);
      expect(response.headers.location).toBe(`/api/tasks/${TASK_ID}`);
      expect(response.body).toEqual({ ...enqueued, statusUrl: `/api/tasks/${TASK_ID}` });
      expect(enqueue).toHaveBeenCalledWith({
        type: 'data_sync',
        payload: VALID_PAYLOADS.data_sync,
      });
    });

    it.each([
      ['a missing type', { payload: {} }],
      ['a payload that is not an object', { type: 'data_sync', payload: [1, 2] }],
      ['unknown top-level fields', { type: 'data_sync', payload: {}, priority: 1 }],
    ])('answers 400 for %s', async (_label, body) => {
      const response = await request(app).post('/api/tasks').send(body);

      expect(response.status).toBe(400);
      expect(errorOf(response).code).toBe('VALIDATION_ERROR');
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('answers 400 for malformed JSON and 413 for an oversized body', async () => {
      const malformed = await request(app)
        .post('/api/tasks')
        .set('Content-Type', 'application/json')
        .send('{"type":');
      const oversized = await request(app)
        .post('/api/tasks')
        .send({ type: 'data_sync', payload: { blob: 'x'.repeat(20_000) } });

      expect(malformed.status).toBe(400);
      expect(errorOf(malformed).code).toBe('BAD_REQUEST');
      expect(oversized.status).toBe(413);
      expect(errorOf(oversized).code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('answers 422 with the allowed types for an unknown type', async () => {
      enqueue.mockResolvedValue(fail(new InvalidTaskTypeError('sms', TASK_TYPES)));

      const response = await request(app).post('/api/tasks').send({ type: 'sms', payload: {} });

      expect(response.status).toBe(422);
      expect(errorOf(response)).toMatchObject({
        code: 'INVALID_TASK_TYPE',
        details: { allowed: [...TASK_TYPES] },
      });
    });

    it('answers 422 with every payload issue', async () => {
      enqueue.mockResolvedValue(
        fail(
          new InvalidTaskPayloadError('data_sync', ['"source" is required', '"x" is not allowed']),
        ),
      );

      const response = await request(app)
        .post('/api/tasks')
        .send({ type: 'data_sync', payload: { x: 1 } });

      expect(response.status).toBe(422);
      expect(errorOf(response).details).toEqual(['"source" is required', '"x" is not allowed']);
    });

    it('answers 503 + Retry-After when the broker did not confirm the message', async () => {
      enqueue.mockResolvedValue(fail(new TaskEnqueueFailedError(TASK_ID, new Error('timeout'))));

      const response = await request(app)
        .post('/api/tasks')
        .send({ type: 'data_sync', payload: {} });

      expect(response.status).toBe(503);
      expect(response.headers['retry-after']).toBe('5');
      expect(errorOf(response).code).toBe('TASK_ENQUEUE_FAILED');
    });

    it('hides unexpected failures behind a generic 500', async () => {
      enqueue.mockResolvedValue(fail(new UnexpectedError('Saving the task', new Error('secret'))));

      const response = await request(app)
        .post('/api/tasks')
        .send({ type: 'data_sync', payload: {} });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      });
    });

    it('answers 500 when a use case throws (it should not, but the API stays safe)', async () => {
      enqueue.mockRejectedValue(new Error('bug'));

      const response = await request(app)
        .post('/api/tasks')
        .send({ type: 'data_sync', payload: {} });

      expect(response.status).toBe(500);
    });
  });

  describe('GET /api/tasks/:id and /api/tasks/stats', () => {
    it('returns the task', async () => {
      const response = await request(app).get(`/api/tasks/${TASK_ID}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(taskOutput);
      expect(status).toHaveBeenCalledWith({ taskId: TASK_ID });
    });

    it('answers 404 for an unknown task and 400 for a malformed id', async () => {
      status.mockResolvedValue(fail(new TaskNotFoundError(TASK_ID)));

      const missing = await request(app).get(`/api/tasks/${TASK_ID}`);
      const malformed = await request(app).get('/api/tasks/not-a-uuid');

      expect(missing.status).toBe(404);
      expect(errorOf(missing).code).toBe('TASK_NOT_FOUND');
      expect(malformed.status).toBe(400);
    });

    it('returns the counts by status (not mistaken for a task id)', async () => {
      const response = await request(app).get('/api/tasks/stats');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(stats);
      expect(status).not.toHaveBeenCalled();
    });

    it('answers 500 when the stats cannot be computed', async () => {
      getStats.mockResolvedValue(fail(new UnexpectedError('Counting', new Error('db'))));

      expect((await request(app).get('/api/tasks/stats')).status).toBe(500);
    });
  });

  describe('operations endpoints', () => {
    it('GET /health answers 200 when healthy, 503 when degraded or shutting down', async () => {
      const ok200 = await request(app).get('/health');
      health.mockResolvedValue(
        ok({ ...healthy, status: 'degraded', checks: { database: 'down' } }),
      );
      const degraded = await request(app).get('/health');
      health.mockResolvedValue(ok(healthy));
      accepting = false;
      const draining = await request(app).get('/health');

      expect(ok200.status).toBe(200);
      expect(ok200.body).toEqual(healthy);
      expect(degraded.status).toBe(503);
      expect(draining.status).toBe(503);
      expect(draining.body).toMatchObject({ status: 'shutting_down' });
    });

    it('GET /metrics answers in the Prometheus text format', async () => {
      const response = await request(app).get('/metrics');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/^text\/plain;.*version=0\.0\.4/);
      expect(response.text).toBe('# 0 counters');
    });

    it('answers 404 JSON for unknown routes', async () => {
      const response = await request(app).delete('/api/tasks');

      expect(response.status).toBe(404);
      expect(errorOf(response).code).toBe('NOT_FOUND');
    });

    it('serves only /health and /metrics when built for a worker', async () => {
      const workerApp = createHttpApp({
        logger: createLoggerMock(),
        healthController: new HealthController({ execute: health }),
        metricsController: new MetricsController(new RecordingMetrics()),
      });

      expect((await request(workerApp).get('/health')).status).toBe(200);
      expect((await request(workerApp).post('/api/tasks').send({})).status).toBe(404);
    });
  });
});
