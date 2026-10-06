import { setTimeout as sleep } from 'node:timers/promises';
import type { SimulatedWorkOutcome, WorkSimulator } from '@application/interfaces/work-simulator';
import type { WorkSimulationConfig } from '@infrastructure/config/env';
import type { TaskTypeValue } from '@domain/value-objects/task-type.value-object';

/** Relative cost of each task type (a report takes longer than an email). */
export const DURATION_WEIGHTS: Readonly<Record<TaskTypeValue, number>> = {
  email_notification: 0.5,
  data_sync: 1,
  certificate_generation: 1.5,
  report_generation: 2,
};

const TRANSIENT_FAILURES: Readonly<Record<TaskTypeValue, string>> = {
  email_notification: 'SMTP server timed out (simulated)',
  data_sync: 'SIS API answered 503 Service Unavailable (simulated)',
  certificate_generation: 'PDF renderer crashed (simulated)',
  report_generation: 'Report query timed out (simulated)',
};

export type RandomSource = () => number;

/** Waits `duration × weight ± jitter` ms; fails with probability `failureRate`. */
export class TimerWorkSimulator implements WorkSimulator {
  constructor(
    private readonly config: WorkSimulationConfig,
    private readonly random: RandomSource = Math.random,
  ) {}

  async perform(type: TaskTypeValue): Promise<SimulatedWorkOutcome> {
    const base = this.config.durationMs * DURATION_WEIGHTS[type];
    const jitter = base * this.config.jitter * (this.random() * 2 - 1);
    const durationMs = Math.max(0, Math.round(base + jitter));
    if (durationMs > 0) {
      await sleep(durationMs);
    }
    if (this.random() < this.config.failureRate) {
      return { ok: false, durationMs, reason: TRANSIENT_FAILURES[type] };
    }
    return { ok: true, durationMs };
  }
}
