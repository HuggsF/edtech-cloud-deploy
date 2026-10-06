export type QueueDepthSample = {
  readonly queue: string;
  readonly depth: number;
  readonly sampledAt: Date;
};
