import { loadConfig, loadEnvFile } from '@infrastructure/config/env';
import { createLogger } from '@infrastructure/logging/logger';
import type { TaskTypeValue } from '@domain/value-objects/task-type.value-object';

type TaskTemplate = {
  readonly type: TaskTypeValue;
  readonly payload: Record<string, unknown>;
};

const TEMPLATES: readonly TaskTemplate[] = [
  {
    type: 'email_notification',
    payload: {
      to: 'loadtest@edtech.org',
      template: 'grade_published',
      subject: 'Weekly Activity Summary',
    },
  },
  {
    type: 'report_generation',
    payload: {
      reportType: 'grade_summary',
      courseId: 'CS-404',
      format: 'pdf',
    },
  },
  {
    type: 'data_sync',
    payload: {
      source: 'lms',
      entity: 'students',
      since: '2026-01-01',
      batchSize: 100,
    },
  },
  {
    type: 'certificate_generation',
    payload: {
      studentId: 'STU-LOAD',
      studentName: 'Candidate Test',
      courseId: 'CS-404',
    },
  },
];

type LoadTestStats = {
  total: number;
  successes: number;
  failures: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  totalDurationMs: number;
  throughputRps: number;
};

export const runLoadTest = async (count = 50, concurrency = 5): Promise<LoadTestStats> => {
  loadEnvFile();
  const config = loadConfig();
  const logger = createLogger({ ...config.log, name: 'edtech-load-test' });
  const apiUrl = `http://localhost:${config.http.port}/api/tasks`;

  logger.info({ apiUrl, totalTasks: count, concurrency }, 'Starting API load test...');

  const latencies: number[] = [];
  let successes = 0;
  let failures = 0;

  const startTime = Date.now();
  let completed = 0;

  const worker = async (): Promise<void> => {
    while (completed < count) {
      const currentIndex = completed;
      completed += 1;
      if (currentIndex >= count) break;

      const template = TEMPLATES[currentIndex % TEMPLATES.length];
      if (!template) continue;

      const reqStart = Date.now();
      try {
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: template.type, payload: template.payload }),
        });

        const reqDuration = Date.now() - reqStart;
        latencies.push(reqDuration);

        if (response.status === 202) {
          successes += 1;
        } else {
          failures += 1;
          logger.warn({ status: response.status }, 'Unexpected HTTP response status');
        }
      } catch (err: unknown) {
        failures += 1;
        logger.error({ err }, 'Network error during request execution');
      }
    }
  };

  const pool = Array.from({ length: concurrency }, () => worker());
  await Promise.all(pool);

  const totalDurationMs = Date.now() - startTime;
  latencies.sort((a, b) => a - b);

  const minLatencyMs = latencies[0] ?? 0;
  const maxLatencyMs = latencies[latencies.length - 1] ?? 0;
  const sumLatency = latencies.reduce((acc, val) => acc + val, 0);
  const avgLatencyMs = latencies.length > 0 ? Math.round(sumLatency / latencies.length) : 0;
  const p95Index = Math.floor(latencies.length * 0.95);
  const p95LatencyMs = latencies[p95Index] ?? maxLatencyMs;
  const throughputRps =
    totalDurationMs > 0 ? Math.round((successes / (totalDurationMs / 1000)) * 10) / 10 : 0;

  const report: LoadTestStats = {
    total: count,
    successes,
    failures,
    minLatencyMs,
    maxLatencyMs,
    avgLatencyMs,
    p95LatencyMs,
    totalDurationMs,
    throughputRps,
  };

  logger.info(report, 'Load test completed');
  return report;
};

void runLoadTest().catch((error: unknown) => {
  process.stderr.write(`Load test failed: ${String(error)}\n`);
  process.exit(1);
});
