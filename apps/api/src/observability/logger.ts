import { randomUUID } from "node:crypto";

type RequestWithContext = {
  ctx?: {
    ipHash?: string | null;
    tenantId?: string | null;
    traceId?: string | null;
    userAgent?: string | null;
    userId?: string | null;
  };
  headers: Record<string, unknown>;
  hostname?: string;
  id: string;
  ip?: string;
  method?: string;
  url?: string;
};

export function createApiLoggerOptions() {
  return {
    disableRequestLogging: true,
    genReqId(request: RequestWithContext) {
      const headerValue = request.headers["x-request-id"];
      if (typeof headerValue === "string" && headerValue.trim()) {
        return headerValue.trim();
      }
      return randomUUID();
    },
    level: process.env.LOG_LEVEL?.trim() || "info",
    redact: {
      censor: "[REDACTED]",
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers.set-cookie",
      ],
    },
    serializers: {
      req(request: RequestWithContext) {
        return {
          hostname: request.hostname,
          ip: request.ip,
          method: request.method,
          requestId: request.id,
          tenantId: request.ctx?.tenantId ?? null,
          traceId: request.ctx?.traceId ?? null,
          url: request.url,
          userId: request.ctx?.userId ?? null,
        };
      },
      res(reply: { statusCode: number }) {
        return {
          statusCode: reply.statusCode,
        };
      },
    },
  };
}

export function logApiRequestStart(
  logger: { info: (fields: Record<string, unknown>, message: string) => void },
  request: RequestWithContext,
): void {
  logger.info(
    {
      ipHash: request.ctx?.ipHash ?? null,
      method: request.method,
      requestId: request.id,
      tenantId: request.ctx?.tenantId ?? null,
      traceId: request.ctx?.traceId ?? null,
      url: request.url,
      userId: request.ctx?.userId ?? null,
    },
    "api request received",
  );
}

export function logApiRequestComplete(
  logger: { info: (fields: Record<string, unknown>, message: string) => void },
  request: RequestWithContext,
  statusCode: number,
  responseTimeMs: number,
): void {
  logger.info(
    {
      requestId: request.id,
      responseTimeMs,
      statusCode,
      tenantId: request.ctx?.tenantId ?? null,
      traceId: request.ctx?.traceId ?? null,
      userId: request.ctx?.userId ?? null,
    },
    "api request completed",
  );
}
