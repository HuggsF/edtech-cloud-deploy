import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import type {
  CounterName,
  GaugeName,
  HistogramName,
  MetricLabels,
  MetricsExporter,
} from '@application/interfaces/metrics-exporter';

type MetricDefinition = { readonly help: string; readonly labelNames: readonly string[] };

const COUNTERS: Readonly<Record<CounterName, MetricDefinition>> = {
  task_processed_total: {
    help: 'Task processing attempts by outcome (completed | failed | retried) and task type',
    labelNames: ['status', 'type'],
  },
  task_enqueued_total: {
    help: 'Tasks accepted by the API and confirmed by the broker, by task type',
    labelNames: ['type'],
  },
  messages_dead_lettered_total: {
    help: 'Messages rejected to the dead-letter queue, by reason',
    labelNames: ['reason'],
  },
};

const GAUGES: Readonly<Record<GaugeName, MetricDefinition>> = {
  queue_depth: {
    help: 'Messages ready for delivery in a RabbitMQ queue (sampled periodically)',
    labelNames: ['queue'],
  },
  active_connections: {
    help: 'Open connections held by this process, by resource (http | mysql | amqp)',
    labelNames: ['resource'],
  },
  tasks_in_flight: {
    help: 'Messages delivered to this worker and not yet acknowledged',
    labelNames: [],
  },
};

const HISTOGRAMS: Readonly<
  Record<HistogramName, MetricDefinition & { readonly buckets: readonly number[] }>
> = {
  task_processing_duration_seconds: {
    help: 'Time to process one task attempt (load + work + persist), by task type',
    labelNames: ['type'],
    buckets: [0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2.5, 5, 10, 30],
  },
};

export type GaugeSample = { readonly value: number; readonly labels?: MetricLabels };

/** Computes gauge values lazily, at scrape time (connection counts, in-flight messages). */
export type GaugeCollector = () => readonly GaugeSample[];

export type PrometheusMetricsExporterOptions = {
  /** Added to every series: `service="api"` or `service="worker"`. */
  readonly service: string;
  /** Node.js runtime metrics (event loop lag, heap, GC, CPU). Default: true. */
  readonly defaultMetrics?: boolean;
};

/**
 * prom-client implementation of the MetricsExporter port. Each instance owns its own Registry
 * (no global state): two apps in one process — or two tests — never collide.
 */
export class PrometheusMetricsExporter implements MetricsExporter {
  readonly registry = new Registry();
  private readonly counters = new Map<CounterName, Counter>();
  private readonly gauges = new Map<GaugeName, Gauge>();
  private readonly histograms = new Map<HistogramName, Histogram>();
  private readonly collectors = new Map<GaugeName, GaugeCollector[]>();

  constructor(options: PrometheusMetricsExporterOptions) {
    this.registry.setDefaultLabels({ service: options.service });
    if (options.defaultMetrics ?? true) {
      collectDefaultMetrics({ register: this.registry });
    }
    const registers = [this.registry];
    for (const [name, definition] of Object.entries(COUNTERS) as [
      CounterName,
      MetricDefinition,
    ][]) {
      this.counters.set(
        name,
        new Counter({ name, help: definition.help, labelNames: definition.labelNames, registers }),
      );
    }
    for (const [name, definition] of Object.entries(GAUGES) as [GaugeName, MetricDefinition][]) {
      const collectors = this.collectorsOf(name);
      this.gauges.set(
        name,
        new Gauge({
          name,
          help: definition.help,
          labelNames: definition.labelNames,
          registers,
          collect(): void {
            for (const collect of collectors) {
              for (const sample of collect()) {
                if (sample.labels === undefined) {
                  this.set(sample.value);
                } else {
                  this.set(sample.labels, sample.value);
                }
              }
            }
          },
        }),
      );
    }
    for (const [name, definition] of Object.entries(HISTOGRAMS) as [
      HistogramName,
      (typeof HISTOGRAMS)[HistogramName],
    ][]) {
      this.histograms.set(
        name,
        new Histogram({
          name,
          help: definition.help,
          labelNames: definition.labelNames,
          buckets: [...definition.buckets],
          registers,
        }),
      );
    }
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  exportGauge(name: GaugeName, value: number, labels: MetricLabels = {}): void {
    this.metric(this.gauges, name).set(labels, value);
  }

  exportCounter(name: CounterName, labels: MetricLabels = {}): void {
    this.metric(this.counters, name).inc(labels);
  }

  exportHistogram(name: HistogramName, value: number, labels: MetricLabels = {}): void {
    this.metric(this.histograms, name).observe(labels, value);
  }

  /** Registers a callback evaluated on every scrape to refresh a gauge. */
  collectGauge(name: GaugeName, collector: GaugeCollector): void {
    this.collectorsOf(name).push(collector);
  }

  getMetricsOutput(): Promise<string> {
    return this.registry.metrics();
  }

  private collectorsOf(name: GaugeName): GaugeCollector[] {
    let collectors = this.collectors.get(name);
    if (collectors === undefined) {
      collectors = [];
      this.collectors.set(name, collectors);
    }
    return collectors;
  }

  private metric<N extends string, M>(metrics: ReadonlyMap<N, M>, name: N): M {
    const metric = metrics.get(name);
    if (metric === undefined) {
      throw new Error(`Metric ${name} is not registered`);
    }
    return metric;
  }
}
