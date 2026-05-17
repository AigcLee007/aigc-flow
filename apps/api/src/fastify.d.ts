import "fastify";

import type { RequestContext } from "./http/request-context.js";
import type { AuthService } from "./modules/auth/auth.service.js";

declare module "fastify" {
  interface FastifyInstance {
    authService: AuthService;
  }

  interface FastifyRequest {
    ctx: RequestContext;
  }
}
