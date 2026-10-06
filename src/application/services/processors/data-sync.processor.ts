import type { Task } from '@domain/entities/task.entity';
import { SimulatedTaskProcessor } from './simulated-task.processor';

export class DataSyncProcessor extends SimulatedTaskProcessor {
  readonly type = 'data_sync';

  protected describe(task: Task): string {
    const entity = task.payload.getString('entity') ?? 'records';
    const source = (task.payload.getString('source') ?? 'unknown').toUpperCase();
    const since = task.payload.getString('since') ?? 'the beginning';
    const batchSize = task.payload.getNumber('batchSize') ?? 500;
    return `Synchronised ${entity} from ${source} since ${since} in batches of ${batchSize}`;
  }
}
