import './module-aliases';
import { run } from './run';

/** API entry point: POST/GET /api/tasks, /metrics, /health. */
run('api');
