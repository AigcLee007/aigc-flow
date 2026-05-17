import { createPgPool, withTenantTransaction } from "@aigc-flow/db";
import type { Pool } from "pg";

import type {
  QueueHealthResponse,
  QueueHealthService,
} from "../queues/queues.service.js";

type PgPool = Pool;

type ObservabilityContext = {
  tenantId: string;
  userId: string | null;
};

export type AdminHealthResponse = {
  database: {
    status: "degraded" | "ok";
  };
  queues: QueueHealthResponse["queues"];
  redis: QueueHealthResponse["redis"];
  status: "degraded" | "ok";
  timestamp: string;
  uptimeSeconds: number;
  version: string | null;
};

export type AdminMetricsResponse = {
  memoryUsage: NodeJS.MemoryUsage;
  process: {
    pid: number;
    uptimeSeconds: number;
  };
  queueCounts: QueueHealthResponse["queues"];
  timestamp: string;
  workflowRuns: {
    failed: number;
    total: number;
  };
};

export class ObservabilityService {
  readonly pool: PgPool;
  readonly queueHealthService: QueueHealthService;

  constructor(options: {
    pool?: PgPool;
    queueHealthService: QueueHealthService;
  }) {
    this.pool = options.pool ?? createPgPool();
    this.queueHealthService = options.queueHealthService;
  }

  async getAdminHealth(): Promise<AdminHealthResponse> {
    const timestamp = new Date().toISOString();
    let databaseStatus: "degraded" | "ok" = "ok";
    let queueHealth: QueueHealthResponse = {
      queues: [],
      redis: {
        status: "degraded",
      },
    };

    try {
      await this.pool.query("SELECT 1");
    } catch {
      databaseStatus = "degraded";
    }

    try {
      queueHealth = await this.queueHealthService.getHealth();
    } catch {
      queueHealth = {
        queues: [],
        redis: {
          status: "degraded",
        },
      };
    }

    return {
      database: {
        status: databaseStatus,
      },
      queues: queueHealth.queues,
      redis: queueHealth.redis,
      status: databaseStatus === "ok" && queueHealth.redis.status === "ok" ? "ok" : "degraded",
      timestamp,
      uptimeSeconds: Math.round(process.uptime()),
      version: process.env.APP_VERSION?.trim() || null,
    };
  }

  async getAdminMetrics(context: ObservabilityContext): Promise<AdminMetricsResponse> {
    const queueHealth = await this.queueHealthService.getHealth().catch(() => ({
      queues: [],
      redis: {
        status: "degraded" as const,
      },
    }));

    const workflowRuns = await withTenantTransaction(context, async (client) => {
      const result = await client.query<{
        failed_count: number;
        total_count: number;
      }>(
        `
          SELECT
            COUNT(*)::int AS total_count,
            COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count
          FROM workflow_runs
        `,
      );

      return {
        failed: result.rows[0]?.failed_count ?? 0,
        total: result.rows[0]?.total_count ?? 0,
      };
    }, this.pool);

    return {
      memoryUsage: process.memoryUsage(),
      process: {
        pid: process.pid,
        uptimeSeconds: Math.round(process.uptime()),
      },
      queueCounts: queueHealth.queues,
      timestamp: new Date().toISOString(),
      workflowRuns,
    };
  }
}
