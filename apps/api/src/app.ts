import Fastify from "fastify";

import { createPgPool } from "@aigc-flow/db";

import { getApiEnv, type ApiEnv } from "./config/env.js";
import { registerRequestContext } from "./http/request-context.js";
import { registerAuthRoutes } from "./modules/auth/auth.routes.js";
import { AuthService } from "./modules/auth/auth.service.js";

type PgPool = ReturnType<typeof createPgPool>;

export function buildApp(options?: {
  env?: ApiEnv;
  logger?: boolean;
  pool?: PgPool;
}) {
  const env = options?.env ?? getApiEnv();
  const ownedPool = !options?.pool;
  const pool = options?.pool ?? createPgPool();
  const authService = new AuthService({
    env,
    pool,
  });

  const app = Fastify({
    logger: options?.logger ?? true,
  });

  app.decorate("authService", authService);
  registerRequestContext(app, authService);

  app.addHook("onClose", async () => {
    if (ownedPool) {
      await pool.end();
    }
  });

  app.get("/health", async () => {
    return { status: "ok" };
  });

  registerAuthRoutes(app);

  return app;
}
