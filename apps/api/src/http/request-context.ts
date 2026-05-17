import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { hashAuditIpAddress } from "@aigc-flow/db";

import type { AuthService } from "../modules/auth/auth.service.js";
import { logApiRequestStart } from "../observability/logger.js";

export type RequestContext = {
  ipHash: string | null;
  isAuthenticated: boolean;
  permissions: string[];
  requestId: string;
  roles: string[];
  sessionId: string | null;
  tenantId: string | null;
  traceId: string;
  userAgent: string | null;
  userId: string | null;
};

function buildAnonymousContext(
  requestId: string,
  traceId: string,
  ipHash: string | null,
  userAgent: string | null,
): RequestContext {
  return {
    ipHash,
    isAuthenticated: false,
    permissions: [],
    requestId,
    roles: [],
    sessionId: null,
    tenantId: null,
    traceId,
    userAgent,
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

function getTraceId(request: FastifyRequest): string {
  const headerValue = request.headers["x-trace-id"];
  if (typeof headerValue === "string" && headerValue.trim()) {
    return headerValue.trim();
  }
  return randomUUID();
}

function getUserAgent(request: FastifyRequest): string | null {
  const headerValue = request.headers["user-agent"];
  if (typeof headerValue === "string" && headerValue.trim()) {
    return headerValue.trim();
  }
  return null;
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
    const requestId = request.id;
    const traceId = getTraceId(request);
    const userAgent = getUserAgent(request);
    const ipHash = hashAuditIpAddress(request.ip);
    const baseContext = buildAnonymousContext(requestId, traceId, ipHash, userAgent);
    const token = getBearerToken(request);

    reply.header("x-request-id", requestId);
    reply.header("x-trace-id", traceId);

    if (!token) {
      request.ctx = baseContext;
      logApiRequestStart(request.log, request);
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
    logApiRequestStart(request.log, request);
  });
}
