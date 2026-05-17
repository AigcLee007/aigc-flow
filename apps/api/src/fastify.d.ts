import "fastify";

import type { StorageProvider } from "@aigc-flow/storage";

import type { RequestContext } from "./http/request-context.js";
import type { AuthService } from "./modules/auth/auth.service.js";
import type { AssetsService } from "./modules/assets/assets.service.js";
import type { FlowsService } from "./modules/flows/flows.service.js";
import type { ProjectsService } from "./modules/projects/projects.service.js";

declare module "fastify" {
  interface FastifyInstance {
    authService: AuthService;
    assetsService: AssetsService;
    flowsService: FlowsService;
    projectsService: ProjectsService;
    storageProvider: StorageProvider;
  }

  interface FastifyRequest {
    ctx: RequestContext;
  }
}
