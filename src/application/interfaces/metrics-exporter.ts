export type CounterName =
  'task_processed_total' | 'task_enqueued_total' | 'messages_dead_lettered_total';

export type GaugeName = 'queue_depth' | 'active_connections' | 'tasks_in_flight';

export type HistogramName = 'task_processing_duration_seconds';

export type MetricName = CounterName | GaugeName | HistogramName;

export type MetricLabels = Readonly<Record<string, string>>;

/**
 * Metrics port. Metric names are a closed union so a typo is a compile error, not a silently
 * missing time series. Implemented with prom-client (Prometheus exposition format).
 */
export interface MetricsExporter {
  exportGauge(name: GaugeName, value: number, labels?: MetricLabels): void;
  exportCounter(name: CounterName, labels?: MetricLabels): void;
  exportHistogram(name: HistogramName, value: number, labels?: MetricLabels): void;
  /** Exposition text for the /metrics endpoint. */
  getMetricsOutput(): Promise<string>;
}
