import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

import {
  requireAuth,
  requirePermission,
  requireTenant,
} from "../../http/auth-middleware.js";
import {
  type CreateWorkflowRunInput,
  type FlowIdParams,
  type RunIdParams,
  type WorkflowRunEventsQuery,
  type WorkflowRunStreamQuery,
  createWorkflowRunSchema,
  flowIdParamsSchema,
  runIdParamsSchema,
  workflowRunEventsQuerySchema,
  workflowRunStreamQuerySchema,
} from "./workflow-runs.schemas.js";
import { WorkflowRunsApiError } from "./workflow-runs.service.js";

const SSE_KEEPALIVE_INTERVAL_MS = 15_000;
const SSE_POLL_INTERVAL_MS = 1_000;

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

function parseQuery<T>(request: FastifyRequest, schema: { parse: (value: unknown) => T }): T {
  return schema.parse(request.query);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function formatSseEvent(input: {
  eventType: string;
  payload: Record<string, unknown>;
  sequence: number;
}): string {
  return `id: ${input.sequence}\nevent: ${input.eventType}\ndata: ${JSON.stringify(input.payload)}\n\n`;
}

function resolveAfterSequence(
  query: WorkflowRunStreamQuery,
  request: FastifyRequest,
): number {
  if (query.afterSequence !== undefined) {
    return query.afterSequence;
  }

  const headerValue = request.headers["last-event-id"];
  const normalizedHeader = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!normalizedHeader) {
    return 0;
  }

  const parsed = Number.parseInt(normalizedHeader, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
}

function getWorkflowRunContext(request: FastifyRequest) {
  if (!request.ctx.tenantId) {
    throw new WorkflowRunsApiError(400, "TENANT_REQUIRED", "A tenant context is required");
  }

  return {
    tenantId: request.ctx.tenantId,
    traceId: request.ctx.traceId,
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

  if (error instanceof WorkflowRunsApiError) {
    return sendError(request, reply, error.statusCode, error.code, error.message);
  }

  request.log.error({ err: error }, "workflow runs route failed");
  return sendError(request, reply, 500, "INTERNAL_ERROR", "Internal server error");
}

export function registerWorkflowRunRoutes(app: FastifyInstance): void {
  const authHandlers = [requireAuth, requireTenant];

  app.post(
    "/api/v2/flows/:flowId/runs",
    {
      preHandler: [...authHandlers, requirePermission("flow:run")],
    },
    async (request, reply) => {
      try {
        const params = parseParams<FlowIdParams>(request, flowIdParamsSchema);
        const body = parseBody<CreateWorkflowRunInput>(request, createWorkflowRunSchema);
        const result = await app.workflowRunsService.createWorkflowRun(
          getWorkflowRunContext(request),
          params.flowId,
          body,
        );
        return reply.code(201).send(result);
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );

  app.get(
    "/api/v2/workflow-runs/:runId",
    {
      preHandler: [...authHandlers, requirePermission("run:read")],
    },
    async (request, reply) => {
      try {
        const params = parseParams<RunIdParams>(request, runIdParamsSchema);
        return reply.send(
          await app.workflowRunsService.getWorkflowRun(
            getWorkflowRunContext(request),
            params.runId,
          ),
        );
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );

  app.get(
    "/api/v2/workflow-runs/:runId/events",
    {
      preHandler: [...authHandlers, requirePermission("run:read")],
    },
    async (request, reply) => {
      try {
        const params = parseParams<RunIdParams>(request, runIdParamsSchema);
        const query = parseQuery<WorkflowRunEventsQuery>(request, workflowRunEventsQuerySchema);
        return reply.send(
          await app.workflowRunsService.listWorkflowRunEvents(
            getWorkflowRunContext(request),
            params.runId,
            query,
          ),
        );
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );

  app.get(
    "/api/v2/workflow-runs/:runId/stream",
    {
      preHandler: [...authHandlers, requirePermission("run:read")],
    },
    async (request, reply) => {
      try {
        const params = parseParams<RunIdParams>(request, runIdParamsSchema);
        const query = parseQuery<WorkflowRunStreamQuery>(request, workflowRunStreamQuerySchema);
        const context = getWorkflowRunContext(request);
        let afterSequence = resolveAfterSequence(query, request);
        let workflowRun = await app.workflowRunsService.getWorkflowRunStatus(
          context,
          params.runId,
        );

        reply.raw.setHeader("cache-control", "no-cache, no-transform");
        reply.raw.setHeader("connection", "keep-alive");
        reply.raw.setHeader("content-type", "text/event-stream; charset=utf-8");
        reply.raw.setHeader("x-workflow-stream-cursor-source", query.afterSequence !== undefined ? "afterSequence" : "last-event-id");
        reply.hijack();
        reply.raw.flushHeaders?.();

        let closed = false;
        const cleanup = () => {
          closed = true;
        };

        request.raw.on("aborted", cleanup);
        request.raw.on("close", cleanup);
        reply.raw.on("close", cleanup);
        reply.raw.on("error", cleanup);

        const keepalive = setInterval(() => {
          if (!closed) {
            reply.raw.write(": ping\n\n");
          }
        }, SSE_KEEPALIVE_INTERVAL_MS);

        try {
          while (!closed) {
            const events = await app.workflowRunsService.listWorkflowRunEvents(
              context,
              params.runId,
              { afterSequence },
            );

            for (const event of events) {
              if (closed) {
                break;
              }

              afterSequence = event.sequence;
              reply.raw.write(
                formatSseEvent({
                  eventType: event.eventType,
                  payload: event.payload,
                  sequence: event.sequence,
                }),
              );
            }

            workflowRun = await app.workflowRunsService.getWorkflowRunStatus(
              context,
              params.runId,
            );
            if (app.workflowRunsService.isTerminalWorkflowRunStatus(workflowRun.status)) {
              break;
            }

            await delay(SSE_POLL_INTERVAL_MS);
          }
        } finally {
          clearInterval(keepalive);
          request.raw.off("aborted", cleanup);
          request.raw.off("close", cleanup);
          reply.raw.off("close", cleanup);
          reply.raw.off("error", cleanup);

          if (!reply.raw.destroyed && !reply.raw.writableEnded) {
            reply.raw.end();
          }
        }

        return reply;
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );

  app.post(
    "/api/v2/workflow-runs/:runId/cancel",
    {
      preHandler: [...authHandlers, requirePermission("run:cancel")],
    },
    async (request, reply) => {
      try {
        const params = parseParams<RunIdParams>(request, runIdParamsSchema);
        return reply.send(
          await app.workflowRunsService.cancelWorkflowRun(
            getWorkflowRunContext(request),
            params.runId,
          ),
        );
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );
}
