import "fastify";

import type { CredentialVault } from "@aigc-flow/ai-gateway-core";
import type { StorageProvider } from "@aigc-flow/storage";

import type { RequestContext } from "./http/request-context.js";
import type { AuthService } from "./modules/auth/auth.service.js";
import type { AiGatewayAdminService } from "./modules/ai-gateway/ai-gateway.service.js";
import type { AssetsService } from "./modules/assets/assets.service.js";
import type { FlowsService } from "./modules/flows/flows.service.js";
import type { ProjectsService } from "./modules/projects/projects.service.js";
import type { QueueHealthService } from "./modules/queues/queues.service.js";

declare module "fastify" {
  interface FastifyInstance {
    aiGatewayService: AiGatewayAdminService;
    authService: AuthService;
    assetsService: AssetsService;
    credentialVault: CredentialVault;
    flowsService: FlowsService;
    projectsService: ProjectsService;
    queueHealthService: QueueHealthService;
    storageProvider: StorageProvider;
  }

  interface FastifyRequest {
    ctx: RequestContext;
  }
}
