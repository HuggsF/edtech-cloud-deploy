import type { TaskTypeValue } from '@domain/value-objects/task-type.value-object';

export type SimulatedWorkOutcome =
  | { readonly ok: true; readonly durationMs: number }
  | { readonly ok: false; readonly durationMs: number; readonly reason: string };

/**
 * Stands in for the slow I/O a real processor would do (SMTP, PDF rendering, SIS API calls):
 * waits for a configurable duration and occasionally fails with a transient error, so queue
 * depth, latency percentiles and error rates are realistic in the demo and in load tests.
 */
export interface WorkSimulator {
  perform(type: TaskTypeValue): Promise<SimulatedWorkOutcome>;
}
