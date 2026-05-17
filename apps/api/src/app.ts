import Fastify from "fastify";

import { CredentialVault } from "@aigc-flow/ai-gateway-core";
import { createPgPool } from "@aigc-flow/db";
import { createQueueFactory, createRedisConnection } from "@aigc-flow/redis";
import { S3StorageProvider, type StorageProvider } from "@aigc-flow/storage";

import { getApiEnv, type ApiEnv } from "./config/env.js";
import { registerRequestContext } from "./http/request-context.js";
import { registerAiGatewayAdminRoutes } from "./modules/ai-gateway/ai-gateway.routes.js";
import { AiGatewayAdminService } from "./modules/ai-gateway/ai-gateway.service.js";
import { registerAuthRoutes } from "./modules/auth/auth.routes.js";
import { AuthService } from "./modules/auth/auth.service.js";
import { registerAssetRoutes } from "./modules/assets/assets.routes.js";
import { AssetsService } from "./modules/assets/assets.service.js";
import { registerFlowRoutes } from "./modules/flows/flows.routes.js";
import { FlowsService } from "./modules/flows/flows.service.js";
import { registerProjectRoutes } from "./modules/projects/projects.routes.js";
import { ProjectsService } from "./modules/projects/projects.service.js";
import { registerQueueRoutes } from "./modules/queues/queues.routes.js";
import { QueueHealthService } from "./modules/queues/queues.service.js";

type PgPool = ReturnType<typeof createPgPool>;

export function buildApp(options?: {
  env?: ApiEnv;
  logger?: boolean;
  pool?: PgPool;
  queueHealthService?: QueueHealthService;
  storageProvider?: StorageProvider;
}) {
  const env = options?.env ?? getApiEnv();
  const ownedPool = !options?.pool;
  const ownedQueueHealthService = !options?.queueHealthService;
  const pool = options?.pool ?? createPgPool();
  const queueHealthRedisConnection = ownedQueueHealthService
    ? createRedisConnection({
        redisUrl: env.redisUrl,
      })
    : null;
  const storageProvider =
    options?.storageProvider ??
    new S3StorageProvider({
      accessKeyId: env.s3AccessKeyId,
      endpoint: env.s3Endpoint,
      forcePathStyle: env.s3ForcePathStyle,
      region: env.s3Region,
      secretAccessKey: env.s3SecretAccessKey,
    });
  const credentialVault = new CredentialVault({
    keyVersion: env.credentialKeyVersion,
    masterKey: env.credentialMasterKey,
  });
  const authService = new AuthService({
    env,
    pool,
  });
  const aiGatewayService = new AiGatewayAdminService({
    credentialVault,
    pool,
  });
  const assetsService = new AssetsService({
    bucket: env.s3Bucket,
    pool,
    storageProvider,
  });
  const queueHealthService =
    options?.queueHealthService ??
    new QueueHealthService(
      queueHealthRedisConnection!,
      {
        queueFactory: createQueueFactory({
          connection: queueHealthRedisConnection!,
          prefix: env.queuePrefix,
        }),
      },
    );
  const projectsService = new ProjectsService({ pool });
  const flowsService = new FlowsService({ pool });

  const app = Fastify({
    logger: options?.logger ?? true,
  });

  app.decorate("aiGatewayService", aiGatewayService);
  app.decorate("authService", authService);
  app.decorate("assetsService", assetsService);
  app.decorate("credentialVault", credentialVault);
  app.decorate("projectsService", projectsService);
  app.decorate("flowsService", flowsService);
  app.decorate("queueHealthService", queueHealthService);
  app.decorate("storageProvider", storageProvider);
  registerRequestContext(app, authService);

  app.addHook("onClose", async () => {
    if (ownedPool) {
      await pool.end();
    }

    if (ownedQueueHealthService) {
      await queueHealthService.close();
    }
  });

  app.get("/health", async () => {
    return { status: "ok" };
  });

  registerAiGatewayAdminRoutes(app);
  registerAuthRoutes(app);
  registerAssetRoutes(app);
  registerProjectRoutes(app);
  registerFlowRoutes(app);
  registerQueueRoutes(app);

  return app;
}
