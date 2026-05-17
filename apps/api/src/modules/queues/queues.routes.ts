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

export function registerQueueRoutes(app: FastifyInstance): void {
  app.get(
    "/api/v2/admin/queues/health",
    {
      preHandler: [
        requireAuth,
        requireTenant,
        requirePermission("admin:system"),
      ],
    },
    async (request, reply) => {
      try {
        return reply.send(await app.queueHealthService.getHealth());
      } catch (error) {
        request.log.error({ err: error }, "queue health route failed");
        return sendError(request, reply, 500, "INTERNAL_ERROR", "Internal server error");
      }
    },
  );
}
