import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

import {
  requireAuth,
  requirePermission,
  requireTenant,
} from "../../http/auth-middleware.js";
import {
  type CreateFlowInput,
  type FlowIdParams,
  type ProjectIdParams,
  type PublishFlowInput,
  type UpdateFlowInput,
  createFlowSchema,
  flowIdParamsSchema,
  projectIdParamsSchema,
  publishFlowSchema,
  updateFlowSchema,
} from "./flows.schemas.js";
import { FlowsApiError } from "./flows.service.js";

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

  if (error instanceof FlowsApiError) {
    return sendError(request, reply, error.statusCode, error.code, error.message);
  }

  request.log.error({ err: error }, "flows route failed");
  return sendError(request, reply, 500, "INTERNAL_ERROR", "Internal server error");
}

function getFlowContext(request: FastifyRequest) {
  if (!request.ctx.tenantId) {
    throw new FlowsApiError(400, "TENANT_REQUIRED", "A tenant context is required");
  }

  return {
    tenantId: request.ctx.tenantId,
    userId: request.ctx.userId,
  };
}

export function registerFlowRoutes(app: FastifyInstance): void {
  const authHandlers = [requireAuth, requireTenant];

  app.get(
    "/api/v2/projects/:projectId/flows",
    {
      preHandler: [...authHandlers, requirePermission("flow:read")],
    },
    async (request, reply) => {
      try {
        const params = parseParams<ProjectIdParams>(request, projectIdParamsSchema);
        const result = await app.flowsService.listFlows(getFlowContext(request), params.projectId);
        return reply.send(result);
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );

  app.post(
    "/api/v2/projects/:projectId/flows",
    {
      preHandler: [...authHandlers, requirePermission("flow:create")],
    },
    async (request, reply) => {
      try {
        const params = parseParams<ProjectIdParams>(request, projectIdParamsSchema);
        const body = parseBody<CreateFlowInput>(request, createFlowSchema);
        const result = await app.flowsService.createFlow(
          getFlowContext(request),
          params.projectId,
          body,
        );
        return reply.code(201).send(result);
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );

  app.get(
    "/api/v2/flows/:flowId",
    {
      preHandler: [...authHandlers, requirePermission("flow:read")],
    },
    async (request, reply) => {
      try {
        const params = parseParams<FlowIdParams>(request, flowIdParamsSchema);
        const result = await app.flowsService.getFlow(getFlowContext(request), params.flowId);
        return reply.send(result);
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );

  app.patch(
    "/api/v2/flows/:flowId",
    {
      preHandler: [...authHandlers, requirePermission("flow:update")],
    },
    async (request, reply) => {
      try {
        const params = parseParams<FlowIdParams>(request, flowIdParamsSchema);
        const body = parseBody<UpdateFlowInput>(request, updateFlowSchema);
        const result = await app.flowsService.updateFlow(
          getFlowContext(request),
          params.flowId,
          body,
        );
        return reply.send(result);
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );

  app.post(
    "/api/v2/flows/:flowId/publish",
    {
      preHandler: [...authHandlers, requirePermission("flow:publish")],
    },
    async (request, reply) => {
      try {
        const params = parseParams<FlowIdParams>(request, flowIdParamsSchema);
        const body = parseBody<PublishFlowInput>(request, publishFlowSchema);
        const result = await app.flowsService.publishFlow(getFlowContext(request), params.flowId, body);
        return reply.code(201).send(result);
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );

  app.get(
    "/api/v2/flows/:flowId/versions",
    {
      preHandler: [...authHandlers, requirePermission("flow:read")],
    },
    async (request, reply) => {
      try {
        const params = parseParams<FlowIdParams>(request, flowIdParamsSchema);
        const result = await app.flowsService.listFlowVersions(getFlowContext(request), params.flowId);
        return reply.send(result);
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );
}
