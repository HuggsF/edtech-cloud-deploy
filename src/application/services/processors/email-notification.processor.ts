import type { Task } from '@domain/entities/task.entity';
import { SimulatedTaskProcessor } from './simulated-task.processor';

/** Domain reserved for demos and tests: addresses on it behave like a hard bounce. */
export const BOUNCE_DOMAIN = '@bounce.test';

export class EmailNotificationProcessor extends SimulatedTaskProcessor {
  readonly type = 'email_notification';

  protected override rejectionReason(task: Task): string | null {
    const to = task.payload.getString('to') ?? '';
    return to.endsWith(BOUNCE_DOMAIN) ? `Mailbox ${to} does not exist (hard bounce)` : null;
  }

  protected describe(task: Task): string {
    const template = task.payload.getString('template') ?? 'unknown';
    const to = task.payload.getString('to') ?? 'unknown';
    return `Email "${template}" delivered to ${to}`;
  }
}
