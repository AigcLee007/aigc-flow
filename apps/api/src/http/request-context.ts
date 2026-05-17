import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AuthService } from "../modules/auth/auth.service.js";

export type RequestContext = {
  isAuthenticated: boolean;
  permissions: string[];
  requestId: string;
  roles: string[];
  sessionId: string | null;
  tenantId: string | null;
  traceId: string;
  userId: string | null;
};

function buildAnonymousContext(requestId: string, traceId: string): RequestContext {
  return {
    isAuthenticated: false,
    permissions: [],
    requestId,
    roles: [],
    sessionId: null,
    tenantId: null,
    traceId,
    userId: null,
  };
}

function getBearerToken(request: FastifyRequest): string | null {
  const authorization = request.headers.authorization;
  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.split(" ");
  if (scheme !== "Bearer" || !token) {
    return null;
  }

  return token.trim() || null;
}

function getRequestId(request: FastifyRequest): string {
  const headerValue = request.headers["x-request-id"];
  if (typeof headerValue === "string" && headerValue.trim()) {
    return headerValue.trim();
  }
  return randomUUID();
}

export function registerRequestContext(
  app: FastifyInstance,
  authService: AuthService,
): void {
  app.decorateRequest("ctx", {
    getter(this: FastifyRequest) {
      return (this as FastifyRequest & { __ctx?: RequestContext }).__ctx as RequestContext;
    },
    setter(this: FastifyRequest, value: RequestContext) {
      (this as FastifyRequest & { __ctx?: RequestContext }).__ctx = value;
    },
  });

  app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = getRequestId(request);
    const traceId = randomUUID();
    const baseContext = buildAnonymousContext(requestId, traceId);
    const token = getBearerToken(request);

    reply.header("x-request-id", requestId);
    reply.header("x-trace-id", traceId);

    if (!token) {
      request.ctx = baseContext;
      return;
    }

    const authenticated = await authService.authenticateAccessToken(token);
    request.ctx = authenticated
      ? {
          ...baseContext,
          ...authenticated,
          isAuthenticated: true,
          requestId,
          traceId,
        }
      : baseContext;
  });
}
