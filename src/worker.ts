import './module-aliases';
import { run } from './run';

/** Worker entry point: consumes the task queue, serves /metrics and /health on METRICS_PORT. */
run('worker');
