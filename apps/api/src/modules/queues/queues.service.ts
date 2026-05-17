import type { Queue } from "bullmq";
import type { Redis } from "ioredis";

import {
  QUEUE_NAMES,
  closeRedisConnection,
  createQueueFactory,
} from "@aigc-flow/redis";

export type QueueHealthCounts = {
  active: number;
  completed: number;
  delayed: number;
  failed: number;
  paused: number;
  waiting: number;
};

export type QueueHealthSummary = {
  counts: QueueHealthCounts;
  name: string;
};

export type QueueHealthResponse = {
  queues: QueueHealthSummary[];
  redis: {
    status: "degraded" | "ok";
  };
};

const HEALTH_QUEUE_NAMES = [
  QUEUE_NAMES.workflowStart,
  QUEUE_NAMES.nodeExecute,
  QUEUE_NAMES.providerPoll,
  QUEUE_NAMES.assetIngest,
  QUEUE_NAMES.billingSettle,
  QUEUE_NAMES.emailSend,
  QUEUE_NAMES.auditFlush,
] as const;

export class QueueHealthService {
  private readonly queues: Queue[];

  constructor(
    private readonly redisConnection: Redis,
    options?: {
      queueFactory?: ReturnType<typeof createQueueFactory>;
    },
  ) {
    const queueFactory =
      options?.queueFactory ??
      createQueueFactory({
        connection: redisConnection,
      });

    this.queues = HEALTH_QUEUE_NAMES.map((queueName) => queueFactory.createQueue(queueName));
  }

  async getHealth(): Promise<QueueHealthResponse> {
    const ping = await this.redisConnection.ping();
    const queues = await Promise.all(
      this.queues.map(async (queue) => {
        const counts = await queue.getJobCounts(
          "waiting",
          "active",
          "completed",
          "failed",
          "delayed",
          "paused",
        );

        return {
          counts: {
            active: counts.active ?? 0,
            completed: counts.completed ?? 0,
            delayed: counts.delayed ?? 0,
            failed: counts.failed ?? 0,
            paused: counts.paused ?? 0,
            waiting: counts.waiting ?? 0,
          },
          name: queue.name,
        };
      }),
    );

    return {
      queues,
      redis: {
        status: ping === "PONG" ? "ok" : "degraded",
      },
    };
  }

  async close(): Promise<void> {
    await Promise.all(this.queues.map((queue) => queue.close()));
    await closeRedisConnection(this.redisConnection);
  }
}
