import "fastify";

import type { RequestContext } from "./http/request-context.js";
import type { AuthService } from "./modules/auth/auth.service.js";
import type { FlowsService } from "./modules/flows/flows.service.js";
import type { ProjectsService } from "./modules/projects/projects.service.js";

declare module "fastify" {
  interface FastifyInstance {
    authService: AuthService;
    flowsService: FlowsService;
    projectsService: ProjectsService;
  }

  interface FastifyRequest {
    ctx: RequestContext;
  }
}
