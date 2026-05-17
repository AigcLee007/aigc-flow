import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  requireAuth,
  requirePermission,
  requireTenant,
} from "../../http/auth-middleware.js";

function sendError(
  request: FastifyRequest,
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
) {
  return reply.code(statusCode).send({
    error: {
      code,
      message,
      requestId: request.ctx.requestId,
    },
  });
}

function getObservabilityContext(request: FastifyRequest) {
  if (!request.ctx.tenantId) {
    throw new Error("tenant required");
  }

  return {
    tenantId: request.ctx.tenantId,
    userId: request.ctx.userId,
  };
}

export function registerObservabilityRoutes(app: FastifyInstance): void {
  const adminHandlers = [
    requireAuth,
    requireTenant,
    requirePermission("admin:system"),
  ];

  app.get(
    "/api/v2/admin/health",
    {
      preHandler: adminHandlers,
    },
    async (request, reply) => {
      try {
        return reply.send(await app.observabilityService.getAdminHealth());
      } catch (error) {
        request.log.error(
          {
            err: error,
            requestId: request.ctx.requestId,
            tenantId: request.ctx.tenantId,
            traceId: request.ctx.traceId,
            userId: request.ctx.userId,
          },
          "admin health route failed",
        );
        return sendError(request, reply, 500, "INTERNAL_ERROR", "Internal server error");
      }
    },
  );

  app.get(
    "/api/v2/admin/metrics",
    {
      preHandler: adminHandlers,
    },
    async (request, reply) => {
      try {
        return reply.send(
          await app.observabilityService.getAdminMetrics(getObservabilityContext(request)),
        );
      } catch (error) {
        request.log.error(
          {
            err: error,
            requestId: request.ctx.requestId,
            tenantId: request.ctx.tenantId,
            traceId: request.ctx.traceId,
            userId: request.ctx.userId,
          },
          "admin metrics route failed",
        );
        return sendError(request, reply, 500, "INTERNAL_ERROR", "Internal server error");
      }
    },
  );
}
