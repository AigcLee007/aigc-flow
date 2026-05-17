import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

import {
  requireAuth,
  requirePermission,
  requireTenant,
} from "../../http/auth-middleware.js";
import {
  type CreateProjectInput,
  type ProjectIdParams,
  type UpdateProjectInput,
  createProjectSchema,
  projectIdParamsSchema,
  updateProjectSchema,
} from "./projects.schemas.js";
import { ProjectsApiError } from "./projects.service.js";

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

  if (error instanceof ProjectsApiError) {
    return sendError(request, reply, error.statusCode, error.code, error.message);
  }

  request.log.error({ err: error }, "projects route failed");
  return sendError(request, reply, 500, "INTERNAL_ERROR", "Internal server error");
}

function getProjectContext(request: FastifyRequest) {
  if (!request.ctx.tenantId) {
    throw new ProjectsApiError(400, "TENANT_REQUIRED", "A tenant context is required");
  }

  return {
    tenantId: request.ctx.tenantId,
    userId: request.ctx.userId,
  };
}

export function registerProjectRoutes(app: FastifyInstance): void {
  const authHandlers = [requireAuth, requireTenant];

  app.get(
    "/api/v2/projects",
    {
      preHandler: [...authHandlers, requirePermission("project:read")],
    },
    async (request, reply) => {
      try {
        return reply.send(await app.projectsService.listProjects(getProjectContext(request)));
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );

  app.post(
    "/api/v2/projects",
    {
      preHandler: [...authHandlers, requirePermission("project:create")],
    },
    async (request, reply) => {
      try {
        const body = parseBody<CreateProjectInput>(request, createProjectSchema);
        const result = await app.projectsService.createProject(getProjectContext(request), body);
        return reply.code(201).send(result);
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );

  app.get(
    "/api/v2/projects/:projectId",
    {
      preHandler: [...authHandlers, requirePermission("project:read")],
    },
    async (request, reply) => {
      try {
        const params = parseParams<ProjectIdParams>(request, projectIdParamsSchema);
        const result = await app.projectsService.getProject(getProjectContext(request), params.projectId);
        return reply.send(result);
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );

  app.patch(
    "/api/v2/projects/:projectId",
    {
      preHandler: [...authHandlers, requirePermission("project:update")],
    },
    async (request, reply) => {
      try {
        const params = parseParams<ProjectIdParams>(request, projectIdParamsSchema);
        const body = parseBody<UpdateProjectInput>(request, updateProjectSchema);
        const result = await app.projectsService.updateProject(
          getProjectContext(request),
          params.projectId,
          body,
        );
        return reply.send(result);
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );

  app.delete(
    "/api/v2/projects/:projectId",
    {
      preHandler: [...authHandlers, requirePermission("project:delete")],
    },
    async (request, reply) => {
      try {
        const params = parseParams<ProjectIdParams>(request, projectIdParamsSchema);
        const result = await app.projectsService.deleteProject(
          getProjectContext(request),
          params.projectId,
        );
        return reply.send(result);
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );
}
