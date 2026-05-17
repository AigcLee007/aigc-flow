import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

import {
  requireAuth,
  requirePermission,
  requireTenant,
} from "../../http/auth-middleware.js";
import { BillingApiError } from "./billing.service.js";
import {
  billingListQuerySchema,
  type BillingListQuery,
} from "./billing.schemas.js";

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

function getBillingContext(request: FastifyRequest) {
  if (!request.ctx.tenantId) {
    throw new BillingApiError(400, "TENANT_REQUIRED", "A tenant context is required");
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

  if (error instanceof BillingApiError) {
    return sendError(request, reply, error.statusCode, error.code, error.message);
  }

  request.log.error({ err: error }, "billing route failed");
  return sendError(request, reply, 500, "INTERNAL_ERROR", "Internal server error");
}

export function registerBillingRoutes(app: FastifyInstance): void {
  const authHandlers = [requireAuth, requireTenant, requirePermission("billing:read")];

  app.get(
    "/api/v2/billing/summary",
    {
      preHandler: authHandlers,
    },
    async (request, reply) => {
      try {
        return reply.send(
          await app.billingService.getBillingSummary(getBillingContext(request)),
        );
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );

  app.get(
    "/api/v2/billing/usage-events",
    {
      preHandler: authHandlers,
    },
    async (request, reply) => {
      try {
        const query = parseQuery<BillingListQuery>(request, billingListQuerySchema);
        return reply.send(
          await app.billingService.listUsageEvents(getBillingContext(request), query),
        );
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );

  app.get(
    "/api/v2/billing/ledger",
    {
      preHandler: authHandlers,
    },
    async (request, reply) => {
      try {
        const query = parseQuery<BillingListQuery>(request, billingListQuerySchema);
        return reply.send(
          await app.billingService.listLedgerEntries(getBillingContext(request), query),
        );
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );
}
