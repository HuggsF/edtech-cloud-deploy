/**
 * Verifies the two properties the AWS deployment relies on, against the RUNNING
 * docker-compose stack (API + RabbitMQ + MySQL + N worker replicas):
 *
 *   1. Stateless workers scale horizontally: the same backlog drains ~N× faster with N replicas
 *      (the reason ECS can scale the worker service on queue depth).
 *   2. Graceful shutdown: a worker receiving SIGTERM in the middle of the load stops consuming,
 *      finishes its in-flight tasks and exits — no task is lost or left in `processing`.
 *
 *   docker compose up -d --build
 *   npm run bench:scaling                      # backlog 2,000 · replicas 1,2,4
 *   npm run bench:scaling -- --backlog 5000 --replicas 1,2,4,8
 *
 * Writes benchmarks/scaling-results.md and benchmarks/scaling-results.json.
 */
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { arch, cpus, platform } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import { Command } from 'commander';
import { z } from 'zod';

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = join(__dirname, '..');
const RESULTS_DIR = join(PROJECT_ROOT, 'benchmarks');
const ENQUEUE_CONCURRENCY = 50;
const POLL_INTERVAL_MS = 250;

type Status = 'pending' | 'processing' | 'completed' | 'failed';

type Stats = {
  readonly byStatus: Readonly<Record<Status, number>>;
  readonly total: number;
  readonly queue: { readonly name: string; readonly depth: number | null };
};

type ScalingResult = {
  readonly replicas: number;
  readonly backlog: number;
  readonly enqueueMs: number;
  readonly drainMs: number;
  readonly tasksPerSecond: number;
  readonly perWorkerTasksPerSecond: number;
  readonly peakQueueDepth: number;
  readonly failed: number;
};

type ShutdownResult = {
  readonly replicas: number;
  readonly backlog: number;
  readonly stoppedContainer: string;
  readonly completedAtSigterm: number;
  readonly inFlightAtStop: number | null;
  readonly drainedMs: number | null;
  readonly completed: number;
  readonly failed: number;
  readonly stuckInProcessing: number;
  readonly redelivered: number;
  readonly lost: number;
};

const optionsSchema = z.object({
  backlog: z.coerce.number().int().min(10).max(100_000),
  replicas: z
    .string()
    .transform((value) => value.split(',').map((item) => Number(item.trim())))
    .pipe(z.array(z.number().int().min(1).max(32)).min(1)),
  shutdownBacklog: z.coerce.number().int().min(10).max(100_000),
  api: z.string().url(),
  timeoutMs: z.coerce.number().int().positive(),
});
type Options = z.infer<typeof optionsSchema>;

const TEMPLATES: readonly { readonly type: string; readonly payload: Record<string, unknown> }[] = [
  {
    type: 'email_notification',
    payload: { to: 'bench@edtech.org', template: 'grade_published', subject: 'Weekly summary' },
  },
  {
    type: 'report_generation',
    payload: { reportType: 'grade_summary', courseId: 'CS-404', format: 'pdf' },
  },
  {
    type: 'data_sync',
    payload: { source: 'lms', entity: 'students', since: '2026-01-01', batchSize: 100 },
  },
  {
    type: 'certificate_generation',
    payload: { studentId: 'STU-BENCH', studentName: 'Benchmark Student', courseId: 'CS-404' },
  },
];

const docker = async (args: readonly string[]): Promise<string> => {
  const { stdout } = await execFileAsync('docker', [...args], {
    cwd: PROJECT_ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
};

const stats = async (options: Options): Promise<Stats> => {
  const response = await fetch(`${options.api}/api/tasks/stats`);
  if (!response.ok) {
    throw new Error(`GET /api/tasks/stats answered HTTP ${response.status}`);
  }
  return (await response.json()) as Stats;
};

const workerContainers = async (): Promise<string[]> =>
  (await docker(['compose', 'ps', '--format', '{{.Name}}', 'worker']))
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .sort();

/** Scales the worker service and waits until every replica has registered as a consumer. */
const scaleWorkers = async (replicas: number): Promise<void> => {
  await docker(['compose', 'up', '-d', '--no-recreate', '--scale', `worker=${replicas}`, 'worker']);
  const deadline = performance.now() + 120_000;
  while ((await consumerCount()) !== replicas) {
    if (performance.now() > deadline) {
      throw new Error(`Timed out waiting for ${replicas} consumers`);
    }
    await sleep(1000);
  }
};

const consumerCount = async (): Promise<number> => {
  const output = await docker([
    'compose',
    'exec',
    '-T',
    'rabbitmq',
    'rabbitmqctl',
    'list_queues',
    '-q',
    'name',
    'consumers',
  ]);
  const line = output.split('\n').find((row) => row.trim().startsWith('edtech.tasks\t'));
  return Number(line?.split('\t')[1] ?? 0);
};

const enqueue = async (options: Options, count: number): Promise<void> => {
  let next = 0;
  const workers = Array.from({ length: Math.min(ENQUEUE_CONCURRENCY, count) }, async () => {
    while (next < count) {
      const index = next;
      next += 1;
      const template = TEMPLATES[index % TEMPLATES.length];
      if (template === undefined) continue;
      const response = await fetch(`${options.api}/api/tasks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(template),
      });
      if (response.status !== 202) {
        throw new Error(`POST /api/tasks answered HTTP ${response.status}`);
      }
    }
  });
  await Promise.all(workers);
};

const delta = (after: Stats, before: Stats, status: Status): number =>
  after.byStatus[status] - before.byStatus[status];

/** Polls until every new task is finished; returns the peak queue depth observed. */
const waitForDrain = async (
  options: Options,
  baseline: Stats,
  expected: number,
): Promise<{ readonly settled: Stats; readonly peakDepth: number }> => {
  const deadline = performance.now() + options.timeoutMs;
  let peakDepth = 0;
  for (;;) {
    const current = await stats(options);
    peakDepth = Math.max(peakDepth, current.queue.depth ?? 0);
    const finished = delta(current, baseline, 'completed') + delta(current, baseline, 'failed');
    const busy = current.byStatus.pending + current.byStatus.processing;
    if (finished >= expected && busy === 0 && (current.queue.depth ?? 0) === 0) {
      return { settled: current, peakDepth };
    }
    if (performance.now() > deadline) {
      throw new Error(`Timed out draining ${expected} tasks: ${JSON.stringify(current)}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
};

const measureScaling = async (options: Options, replicas: number): Promise<ScalingResult> => {
  await scaleWorkers(replicas);
  const baseline = await stats(options);
  const startedAt = performance.now();
  await enqueue(options, options.backlog);
  const enqueueMs = performance.now() - startedAt;
  const { settled, peakDepth } = await waitForDrain(options, baseline, options.backlog);
  const drainMs = performance.now() - startedAt;
  const tasksPerSecond = options.backlog / (drainMs / 1000);
  return {
    replicas,
    backlog: options.backlog,
    enqueueMs: Math.round(enqueueMs),
    drainMs: Math.round(drainMs),
    tasksPerSecond: Math.round(tasksPerSecond * 10) / 10,
    perWorkerTasksPerSecond: Math.round((tasksPerSecond / replicas) * 10) / 10,
    peakQueueDepth: peakDepth,
    failed: delta(settled, baseline, 'failed'),
  };
};

const mysql = async (sql: string): Promise<string> =>
  (
    await docker([
      'compose',
      'exec',
      '-T',
      'mysql',
      'mysql',
      '-uedtech',
      '-pedtech_secret',
      'edtech',
      '-N',
      '-e',
      sql,
    ])
  ).trim();

const measureShutdown = async (options: Options): Promise<ShutdownResult> => {
  await scaleWorkers(2);
  const [victim] = await workerContainers();
  if (victim === undefined) {
    throw new Error('No worker container found');
  }
  const baseline = await stats(options);
  const sinceIso = new Date().toISOString();
  const sinceSql = sinceIso.slice(0, 19).replace('T', ' ');
  await enqueue(options, options.shutdownBacklog);

  // SIGTERM one replica once roughly a third of the backlog is done (it is busy at that moment).
  for (;;) {
    const current = await stats(options);
    if (delta(current, baseline, 'completed') >= options.shutdownBacklog / 3) break;
    await sleep(POLL_INTERVAL_MS);
  }
  const completedAtSigterm = delta(await stats(options), baseline, 'completed');
  await docker(['stop', '--time', '35', victim]);

  const { settled } = await waitForDrain(options, baseline, options.shutdownBacklog);
  const logs = await docker(['logs', '--since', sinceIso, victim]);
  const drainLine = logs.split('\n').find((line) => line.includes('In-flight messages drained'));
  const drain = drainLine === undefined ? null : (JSON.parse(drainLine) as Record<string, unknown>);
  const redelivered = Number(
    await mysql(`SELECT COUNT(*) FROM tasks WHERE attempts > 1 AND created_at >= '${sinceSql}'`),
  );
  await docker(['start', victim]);

  const completed = delta(settled, baseline, 'completed');
  const failed = delta(settled, baseline, 'failed');
  return {
    replicas: 2,
    backlog: options.shutdownBacklog,
    stoppedContainer: victim,
    completedAtSigterm,
    inFlightAtStop: typeof drain?.inFlightAtStop === 'number' ? drain.inFlightAtStop : null,
    drainedMs: typeof drain?.waitedMs === 'number' ? drain.waitedMs : null,
    completed,
    failed,
    stuckInProcessing: settled.byStatus.processing,
    redelivered,
    lost: options.shutdownBacklog - completed - failed,
  };
};

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

const toMarkdown = (
  scaling: readonly ScalingResult[],
  shutdown: ShutdownResult,
  environment: string,
): string => {
  const baseline = scaling[0];
  const speedup = (result: ScalingResult): string =>
    baseline === undefined
      ? '—'
      : `${(result.tasksPerSecond / baseline.tasksPerSecond).toFixed(2)}×`;
  return [
    '# Scaling & graceful-shutdown verification — edtech-cloud-deploy',
    '',
    `- **Date:** ${new Date().toISOString()}`,
    `- **Environment:** ${environment}`,
    '- **Workload:** tasks enqueued through `POST /api/tasks` (4 task types); each task simulates 250 ms ± 50% of work and fails transiently 2% of the time (then retried); prefetch 10 per worker.',
    '- **Drain time** = first enqueue → every task `completed`/`failed` in MySQL and the RabbitMQ queue empty.',
    '',
    '## Horizontal scaling (same backlog, more stateless replicas)',
    '',
    '| Worker replicas | Backlog | Drain time | Throughput | Per worker | Speed-up | Peak queue depth | Failed |',
    '|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...scaling.map(
      (result) =>
        `| ${result.replicas} | ${result.backlog.toLocaleString('en-US')} | ${seconds(result.drainMs)} | ${result.tasksPerSecond} tasks/s | ${result.perWorkerTasksPerSecond} tasks/s | ${speedup(result)} | ${result.peakQueueDepth.toLocaleString('en-US')} | ${result.failed} |`,
    ),
    '',
    '## Graceful shutdown (SIGTERM to one of 2 workers mid-load)',
    '',
    '| Backlog | Completed when SIGTERM was sent | In-flight at stop | Drain time | Completed | Failed | Stuck in `processing` | Retried (attempts > 1) | Lost |',
    '|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    `| ${shutdown.backlog.toLocaleString('en-US')} | ${shutdown.completedAtSigterm} | ${shutdown.inFlightAtStop ?? 'n/a'} | ${shutdown.drainedMs === null ? 'n/a' : `${shutdown.drainedMs} ms`} | ${shutdown.completed} | ${shutdown.failed} | ${shutdown.stuckInProcessing} | ${shutdown.redelivered} | **${shutdown.lost}** |`,
    '',
    'Reproduce: `docker compose up -d --build && npm run bench:scaling`.',
    '',
  ].join('\n');
};

const program = new Command()
  .name('scaling-verification')
  .option('--backlog <n>', 'tasks per scaling run', '2000')
  .option('--replicas <list>', 'worker replica counts to measure', '1,2,4')
  .option('--shutdown-backlog <n>', 'tasks for the graceful-shutdown run', '1000')
  .option('--api <url>', 'API base URL', 'http://localhost:3000')
  .option('--timeout-ms <ms>', 'max wait per run', '600000')
  .action(async (raw: unknown) => {
    const options = optionsSchema.parse(raw);
    const write = (line: string): void => {
      process.stdout.write(`${line}\n`);
    };
    const scaling: ScalingResult[] = [];
    for (const replicas of options.replicas) {
      write(`Draining ${options.backlog} tasks with ${replicas} worker(s)…`);
      const result = await measureScaling(options, replicas);
      write(JSON.stringify(result));
      scaling.push(result);
    }
    write('Graceful shutdown: SIGTERM to one of 2 workers mid-load…');
    const shutdown = await measureShutdown(options);
    write(JSON.stringify(shutdown));
    await scaleWorkers(2);

    const environment = `Node ${process.version} · ${platform()} ${arch()} · ${cpus()[0]?.model.trim() ?? 'unknown CPU'} · docker-compose (API + RabbitMQ 3 + MySQL 8 + worker replicas, production images)`;
    const markdown = toMarkdown(scaling, shutdown, environment);
    await mkdir(RESULTS_DIR, { recursive: true });
    await writeFile(join(RESULTS_DIR, 'scaling-results.md'), markdown, 'utf8');
    await writeFile(
      join(RESULTS_DIR, 'scaling-results.json'),
      JSON.stringify(
        { measuredAt: new Date().toISOString(), environment, scaling, shutdown },
        null,
        2,
      ),
      'utf8',
    );
    write(`\n${markdown}`);
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  process.stderr.write(
    `scaling verification failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
