import type { Task } from '@domain/entities/task.entity';
import { SimulatedTaskProcessor, shortReference } from './simulated-task.processor';

export class ReportGenerationProcessor extends SimulatedTaskProcessor {
  readonly type = 'report_generation';

  protected describe(task: Task): string {
    const reportType = task.payload.getString('reportType') ?? 'report';
    const courseId = task.payload.getString('courseId') ?? 'unknown';
    const format = task.payload.getString('format') ?? 'pdf';
    return `Report generated: reports/${courseId}/${reportType}-${shortReference(task.id)}.${format}`;
  }
}
