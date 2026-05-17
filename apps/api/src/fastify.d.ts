import "fastify";

import type { CredentialVault } from "@aigc-flow/ai-gateway-core";
import type { StorageProvider } from "@aigc-flow/storage";

import type { RequestContext } from "./http/request-context.js";
import type { AuditApiService } from "./modules/audit/audit.service.js";
import type { AuthService } from "./modules/auth/auth.service.js";
import type { AiGatewayAdminService } from "./modules/ai-gateway/ai-gateway.service.js";
import type { AssetsService } from "./modules/assets/assets.service.js";
import type { BillingApiService } from "./modules/billing/billing.service.js";
import type { FlowsService } from "./modules/flows/flows.service.js";
import type { ObservabilityService } from "./modules/observability/observability.service.js";
import type { ProjectsService } from "./modules/projects/projects.service.js";
import type { QueueHealthService } from "./modules/queues/queues.service.js";
import type { WorkflowRunsService } from "./modules/workflow-runs/workflow-runs.service.js";

declare module "fastify" {
  interface FastifyInstance {
    aiGatewayService: AiGatewayAdminService;
    auditService: AuditApiService;
    authService: AuthService;
    assetsService: AssetsService;
    billingService: BillingApiService;
    credentialVault: CredentialVault;
    flowsService: FlowsService;
    observabilityService: ObservabilityService;
    projectsService: ProjectsService;
    queueHealthService: QueueHealthService;
    storageProvider: StorageProvider;
    workflowRunsService: WorkflowRunsService;
  }

  interface FastifyRequest {
    ctx: RequestContext;
  }
}
