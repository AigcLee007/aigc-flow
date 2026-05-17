import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

import {
  requireAuth,
  requirePermission,
  requireTenant,
} from "../../http/auth-middleware.js";
import { AuditApiError } from "./audit.service.js";
import {
  type AuditLogsQuery,
  auditLogsQuerySchema,
} from "./audit.schemas.js";

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

function parseQuery<T>(request: FastifyRequest, schema: { parse: (value: unknown) => T }): T {
  return schema.parse(request.query);
}

function getAuditContext(request: FastifyRequest) {
  if (!request.ctx.tenantId) {
    throw new AuditApiError(400, "TENANT_REQUIRED", "A tenant context is required");
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

  if (error instanceof AuditApiError) {
    return sendError(request, reply, error.statusCode, error.code, error.message);
  }

  request.log.error(
    {
      err: error,
      requestId: request.ctx.requestId,
      tenantId: request.ctx.tenantId,
      traceId: request.ctx.traceId,
      userId: request.ctx.userId,
    },
    "audit route failed",
  );
  return sendError(request, reply, 500, "INTERNAL_ERROR", "Internal server error");
}

export function registerAuditRoutes(app: FastifyInstance): void {
  app.get(
    "/api/v2/audit/logs",
    {
      preHandler: [
        requireAuth,
        requireTenant,
        requirePermission("audit:read"),
      ],
    },
    async (request, reply) => {
      try {
        const query = parseQuery<AuditLogsQuery>(request, auditLogsQuerySchema);
        return reply.send(
          await app.auditService.listAuditLogs(getAuditContext(request), query),
        );
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );
}
