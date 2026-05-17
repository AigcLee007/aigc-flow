import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

import { requireAuth } from "../../http/auth-middleware.js";
import {
  type LoginInput,
  type LogoutInput,
  type RefreshInput,
  type RegisterInput,
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
} from "./auth.schemas.js";
import { AuthApiError } from "./auth.service.js";

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

  if (error instanceof AuthApiError) {
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
    "auth route failed",
  );
  return sendError(request, reply, 500, "INTERNAL_ERROR", "Internal server error");
}

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post("/api/v2/auth/register", async (request, reply) => {
    try {
      const body = parseBody<RegisterInput>(request, registerSchema);
      const result = await app.authService.register(body, {
        ipAddress: request.ip,
        ipHash: request.ctx.ipHash,
        requestId: request.ctx.requestId,
        traceId: request.ctx.traceId,
        userAgent: request.ctx.userAgent,
      });
      return reply.code(201).send(result);
    } catch (error) {
      return handleRouteError(error, request, reply);
    }
  });

  app.post("/api/v2/auth/login", async (request, reply) => {
    try {
      const body = parseBody<LoginInput>(request, loginSchema);
      const result = await app.authService.login(body, {
        ipAddress: request.ip,
        ipHash: request.ctx.ipHash,
        requestId: request.ctx.requestId,
        traceId: request.ctx.traceId,
        userAgent: request.ctx.userAgent,
      });
      return reply.send(result);
    } catch (error) {
      return handleRouteError(error, request, reply);
    }
  });

  app.post("/api/v2/auth/refresh", async (request, reply) => {
    try {
      const body = parseBody<RefreshInput>(request, refreshSchema);
      const result = await app.authService.refresh(body);
      return reply.send(result);
    } catch (error) {
      return handleRouteError(error, request, reply);
    }
  });

  app.post("/api/v2/auth/logout", async (request, reply) => {
    try {
      const body = parseBody<LogoutInput>(request, logoutSchema);
      const result = await app.authService.logout(body, request.ctx);
      return reply.send(result);
    } catch (error) {
      return handleRouteError(error, request, reply);
    }
  });

  app.get(
    "/api/v2/auth/me",
    {
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      try {
        const result = await app.authService.getMe(request.ctx);
        return reply.send(result);
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );
}
