import { z } from 'zod';

/**
 * Shape of the request only. The business rules (known task type, type-specific payload
 * schema) are enforced by the Domain, so they hold for every entry point, not just HTTP.
 */
export const enqueueTaskBodySchema = z
  .object({
    type: z.string().min(1).max(64),
    payload: z.record(z.unknown()),
  })
  .strict();

export const taskIdParamsSchema = z.object({
  id: z.string().uuid(),
});
