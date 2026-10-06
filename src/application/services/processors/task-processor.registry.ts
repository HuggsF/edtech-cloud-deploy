import type { TaskProcessor } from '@application/interfaces/task-processor';
import type { WorkSimulator } from '@application/interfaces/work-simulator';
import { TASK_TYPES } from '@domain/value-objects/task-type.value-object';
import type { TaskType, TaskTypeValue } from '@domain/value-objects/task-type.value-object';
import { CertificateGenerationProcessor } from './certificate-generation.processor';
import { DataSyncProcessor } from './data-sync.processor';
import { EmailNotificationProcessor } from './email-notification.processor';
import { ReportGenerationProcessor } from './report-generation.processor';

/** Strategy lookup: one processor per task type. */
export class TaskProcessorRegistry {
  private readonly processors: ReadonlyMap<TaskTypeValue, TaskProcessor>;

  constructor(processors: readonly TaskProcessor[]) {
    this.processors = new Map(processors.map((processor) => [processor.type, processor]));
  }

  /** The default registry: every task type is handled by its simulated processor. */
  static withSimulatedProcessors(simulator: WorkSimulator): TaskProcessorRegistry {
    return new TaskProcessorRegistry([
      new EmailNotificationProcessor(simulator),
      new ReportGenerationProcessor(simulator),
      new DataSyncProcessor(simulator),
      new CertificateGenerationProcessor(simulator),
    ]);
  }

  forType(type: TaskType): TaskProcessor | null {
    return this.processors.get(type.value) ?? null;
  }

  get missingTypes(): readonly TaskTypeValue[] {
    return TASK_TYPES.filter((type) => !this.processors.has(type));
  }
}
