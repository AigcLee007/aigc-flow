import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

import {
  requireAuth,
  requirePermission,
  requireTenant,
} from "../../http/auth-middleware.js";
import {
  type CreateWorkflowRunInput,
  type FlowIdParams,
  type RunIdParams,
  type WorkflowRunEventsQuery,
  createWorkflowRunSchema,
  flowIdParamsSchema,
  runIdParamsSchema,
  workflowRunEventsQuerySchema,
} from "./workflow-runs.schemas.js";
import { WorkflowRunsApiError } from "./workflow-runs.service.js";

function sendError(
  request: FastifyRequest,
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
  details?: unknown,
) {
  return reply.code(statusCode).send({
    error: {
      code,
      details,
      message,
      requestId: request.ctx.requestId,
    },
  });
}

function parseBody<T>(request: FastifyRequest, schema: { parse: (value: unknown) => T }): T {
  return schema.parse(request.body);
}

function parseParams<T>(request: FastifyRequest, schema: { parse: (value: unknown) => T }): T {
  return schema.parse(request.params);
}

function parseQuery<T>(request: FastifyRequest, schema: { parse: (value: unknown) => T }): T {
  return schema.parse(request.query);
}

function getWorkflowRunContext(request: FastifyRequest) {
  if (!request.ctx.tenantId) {
    throw new WorkflowRunsApiError(400, "TENANT_REQUIRED", "A tenant context is required");
  }

  return {
    tenantId: request.ctx.tenantId,
    traceId: request.ctx.traceId,
    userId: request.ctx.userId,
  };
}

function handleRouteError(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  if (error instanceof ZodError) {
    return sendError(
      request,
      reply,
      400,
      "VALIDATION_ERROR",
      "Request validation failed",
      error.issues,
    );
  }

  if (error instanceof WorkflowRunsApiError) {
    return sendError(request, reply, error.statusCode, error.code, error.message);
  }

  request.log.error({ err: error }, "workflow runs route failed");
  return sendError(request, reply, 500, "INTERNAL_ERROR", "Internal server error");
}

export function registerWorkflowRunRoutes(app: FastifyInstance): void {
  const authHandlers = [requireAuth, requireTenant];

  app.post(
    "/api/v2/flows/:flowId/runs",
    {
      preHandler: [...authHandlers, requirePermission("flow:run")],
    },
    async (request, reply) => {
      try {
        const params = parseParams<FlowIdParams>(request, flowIdParamsSchema);
        const body = parseBody<CreateWorkflowRunInput>(request, createWorkflowRunSchema);
        const result = await app.workflowRunsService.createWorkflowRun(
          getWorkflowRunContext(request),
          params.flowId,
          body,
        );
        return reply.code(201).send(result);
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );

  app.get(
    "/api/v2/workflow-runs/:runId",
    {
      preHandler: [...authHandlers, requirePermission("run:read")],
    },
    async (request, reply) => {
      try {
        const params = parseParams<RunIdParams>(request, runIdParamsSchema);
        return reply.send(
          await app.workflowRunsService.getWorkflowRun(
            getWorkflowRunContext(request),
            params.runId,
          ),
        );
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );

  app.get(
    "/api/v2/workflow-runs/:runId/events",
    {
      preHandler: [...authHandlers, requirePermission("run:read")],
    },
    async (request, reply) => {
      try {
        const params = parseParams<RunIdParams>(request, runIdParamsSchema);
        const query = parseQuery<WorkflowRunEventsQuery>(request, workflowRunEventsQuerySchema);
        return reply.send(
          await app.workflowRunsService.listWorkflowRunEvents(
            getWorkflowRunContext(request),
            params.runId,
            query,
          ),
        );
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );

  app.post(
    "/api/v2/workflow-runs/:runId/cancel",
    {
      preHandler: [...authHandlers, requirePermission("run:cancel")],
    },
    async (request, reply) => {
      try {
        const params = parseParams<RunIdParams>(request, runIdParamsSchema);
        return reply.send(
          await app.workflowRunsService.cancelWorkflowRun(
            getWorkflowRunContext(request),
            params.runId,
          ),
        );
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );
}
