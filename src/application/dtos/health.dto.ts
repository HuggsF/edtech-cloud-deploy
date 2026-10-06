export type DependencyStatus = 'up' | 'down';

export type HealthOutput = {
  readonly status: 'ok' | 'degraded';
  readonly service: string;
  readonly uptimeSeconds: number;
  readonly checks: Readonly<Record<string, DependencyStatus>>;
};
