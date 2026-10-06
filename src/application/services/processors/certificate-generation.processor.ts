import type { Task } from '@domain/entities/task.entity';
import { SimulatedTaskProcessor, shortReference } from './simulated-task.processor';

export class CertificateGenerationProcessor extends SimulatedTaskProcessor {
  readonly type = 'certificate_generation';

  protected describe(task: Task): string {
    const studentName = task.payload.getString('studentName') ?? 'unknown';
    const courseId = task.payload.getString('courseId') ?? 'unknown';
    return `Certificate CERT-${shortReference(task.id)} issued to ${studentName} for course ${courseId}`;
  }
}
