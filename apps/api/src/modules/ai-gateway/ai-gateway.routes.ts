import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

import { AiGatewayError } from "@aigc-flow/ai-gateway-core";

import {
  requireAuth,
  requirePermission,
  requireTenant,
} from "../../http/auth-middleware.js";
import {
  type CreateCredentialInput,
  type CreateModelInput,
  type CreateProviderInput,
  type CreateRouteInput,
  type CredentialIdParams,
  type GenerateTextInput,
  type RotateCredentialInput,
  type RouteIdParams,
  type UpdateCredentialInput,
  type UpdateRouteInput,
  createCredentialSchema,
  generateTextSchema,
  createModelSchema,
  createProviderSchema,
  createRouteSchema,
  credentialIdParamsSchema,
  rotateCredentialSchema,
  routeIdParamsSchema,
  updateCredentialSchema,
  updateRouteSchema,
} from "./ai-gateway.schemas.js";
import { AiGatewayApiError } from "./ai-gateway.service.js";

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

function getTenantContext(request: FastifyRequest) {
  if (!request.ctx.tenantId) {
    throw new AiGatewayApiError(400, "TENANT_REQUIRED", "A tenant context is required");
  }

  return {
    tenantId: request.ctx.tenantId,
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

  if (error instanceof AiGatewayApiError) {
    return sendError(request, reply, error.statusCode, error.code, error.message);
  }

  if (error instanceof AiGatewayError) {
    return sendError(request, reply, error.statusCode, error.code, error.message);
  }

  request.log.error({ err: error }, "ai gateway admin route failed");
  return sendError(request, reply, 500, "INTERNAL_ERROR", "Internal server error");
}

export function registerAiGatewayAdminRoutes(app: FastifyInstance): void {
  const authHandlers = [requireAuth, requireTenant];

  app.post(
    "/api/v2/ai/text/generate",
    {
      preHandler: [...authHandlers, requirePermission("provider:read")],
    },
    async (request, reply) => {
      try {
        const body = parseBody<GenerateTextInput>(request, generateTextSchema);
        return reply.send(await app.aiGatewayService.generateText(getTenantContext(request), body));
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );

  app.get(
    "/api/v2/admin/ai/providers",
    {
      preHandler: [...authHandlers, requirePermission("provider:read")],
    },
    async (request, reply) => {
      try {
        return reply.send(await app.aiGatewayService.listProviders());
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );

  app.post(
    "/api/v2/admin/ai/providers",
    {
      preHandler: [...authHandlers, requirePermission("provider:manage")],
    },
    async (request, reply) => {
      try {
        const body = parseBody<CreateProviderInput>(request, createProviderSchema);
        return reply.code(201).send(await app.aiGatewayService.createProvider(body));
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );

  app.get(
    "/api/v2/admin/ai/models",
    {
      preHandler: [...authHandlers, requirePermission("provider:read")],
    },
    async (request, reply) => {
      try {
        return reply.send(await app.aiGatewayService.listModels());
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );

  app.post(
    "/api/v2/admin/ai/models",
    {
      preHandler: [...authHandlers, requirePermission("provider:manage")],
    },
    async (request, reply) => {
      try {
        const body = parseBody<CreateModelInput>(request, createModelSchema);
        return reply.code(201).send(await app.aiGatewayService.createModel(body));
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );

  app.get(
    "/api/v2/admin/ai/routes",
    {
      preHandler: [...authHandlers, requirePermission("provider:read")],
    },
    async (request, reply) => {
      try {
        return reply.send(await app.aiGatewayService.listRoutes(getTenantContext(request)));
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );

  app.post(
    "/api/v2/admin/ai/routes",
    {
      preHandler: [...authHandlers, requirePermission("provider:manage")],
    },
    async (request, reply) => {
      try {
        const body = parseBody<CreateRouteInput>(request, createRouteSchema);
        return reply.code(201).send(await app.aiGatewayService.createRoute(getTenantContext(request), body));
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );

  app.patch(
    "/api/v2/admin/ai/routes/:routeId",
    {
      preHandler: [...authHandlers, requirePermission("provider:manage")],
    },
    async (request, reply) => {
      try {
        const params = parseParams<RouteIdParams>(request, routeIdParamsSchema);
        const body = parseBody<UpdateRouteInput>(request, updateRouteSchema);
        return reply.send(
          await app.aiGatewayService.updateRoute(getTenantContext(request), params.routeId, body),
        );
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );

  app.get(
    "/api/v2/admin/credentials",
    {
      preHandler: [...authHandlers, requirePermission("credential:manage")],
    },
    async (request, reply) => {
      try {
        return reply.send(await app.aiGatewayService.listCredentials(getTenantContext(request)));
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );

  app.post(
    "/api/v2/admin/credentials",
    {
      preHandler: [...authHandlers, requirePermission("credential:manage")],
    },
    async (request, reply) => {
      try {
        const body = parseBody<CreateCredentialInput>(request, createCredentialSchema);
        return reply.code(201).send(
          await app.aiGatewayService.createCredential(getTenantContext(request), body),
        );
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );

  app.patch(
    "/api/v2/admin/credentials/:credentialId",
    {
      preHandler: [...authHandlers, requirePermission("credential:manage")],
    },
    async (request, reply) => {
      try {
        const params = parseParams<CredentialIdParams>(request, credentialIdParamsSchema);
        const body = parseBody<UpdateCredentialInput>(request, updateCredentialSchema);
        return reply.send(
          await app.aiGatewayService.updateCredential(
            getTenantContext(request),
            params.credentialId,
            body,
          ),
        );
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );

  app.post(
    "/api/v2/admin/credentials/:credentialId/rotate",
    {
      preHandler: [...authHandlers, requirePermission("credential:manage")],
    },
    async (request, reply) => {
      try {
        const params = parseParams<CredentialIdParams>(request, credentialIdParamsSchema);
        const body = parseBody<RotateCredentialInput>(request, rotateCredentialSchema);
        return reply.send(
          await app.aiGatewayService.rotateCredential(
            getTenantContext(request),
            params.credentialId,
            body.secret,
          ),
        );
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );

  app.delete(
    "/api/v2/admin/credentials/:credentialId",
    {
      preHandler: [...authHandlers, requirePermission("credential:manage")],
    },
    async (request, reply) => {
      try {
        const params = parseParams<CredentialIdParams>(request, credentialIdParamsSchema);
        return reply.send(
          await app.aiGatewayService.deleteCredential(
            getTenantContext(request),
            params.credentialId,
          ),
        );
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );
}
