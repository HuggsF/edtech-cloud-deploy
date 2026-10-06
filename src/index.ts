import './module-aliases';
import { run } from './run';

/**
 * Image default entry point (`node dist/index.js`): one image, two roles.
 * APP_ROLE=api (default) or APP_ROLE=worker. ECS task definitions call dist/api.js or
 * dist/worker.js explicitly.
 */
run(process.env.APP_ROLE === 'worker' ? 'worker' : 'api');
