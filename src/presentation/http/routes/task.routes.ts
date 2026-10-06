import { Router } from 'express';
import type { TaskController } from '@presentation/http/controllers/task.controller';

export const buildTaskRouter = (controller: TaskController): Router => {
  const router = Router();
  router.post('/', controller.enqueue);
  // Declared before /:id so "stats" is not parsed as a task id.
  router.get('/stats', controller.stats);
  router.get('/:id', controller.status);
  return router;
};
