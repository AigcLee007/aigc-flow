import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

import {
  requireAuth,
  requirePermission,
  requireTenant,
} from "../../http/auth-middleware.js";
import {
  type AssetIdParams,
  type CompleteUploadInput,
  type PresignedUploadInput,
  assetIdParamsSchema,
  completeUploadSchema,
  presignedUploadSchema,
} from "./assets.schemas.js";
import { AssetsApiError } from "./assets.service.js";

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

function getAssetContext(request: FastifyRequest) {
  if (!request.ctx.tenantId) {
    throw new AssetsApiError(400, "TENANT_REQUIRED", "A tenant context is required");
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

  if (error instanceof AssetsApiError) {
    return sendError(request, reply, error.statusCode, error.code, error.message);
  }

  request.log.error({ err: error }, "assets route failed");
  return sendError(request, reply, 500, "INTERNAL_ERROR", "Internal server error");
}

export function registerAssetRoutes(app: FastifyInstance): void {
  const authHandlers = [requireAuth, requireTenant];

  app.post(
    "/api/v2/assets/presigned-upload",
    {
      preHandler: [...authHandlers, requirePermission("asset:create")],
    },
    async (request, reply) => {
      try {
        const body = parseBody<PresignedUploadInput>(request, presignedUploadSchema);
        const result = await app.assetsService.createPresignedUpload(getAssetContext(request), body);
        return reply.code(201).send(result);
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );

  app.post(
    "/api/v2/assets/:assetId/complete-upload",
    {
      preHandler: [...authHandlers, requirePermission("asset:create")],
    },
    async (request, reply) => {
      try {
        const params = parseParams<AssetIdParams>(request, assetIdParamsSchema);
        const body = parseBody<CompleteUploadInput>(request, completeUploadSchema);
        const result = await app.assetsService.completeUpload(
          getAssetContext(request),
          params.assetId,
          body,
        );
        return reply.send(result);
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );

  app.get(
    "/api/v2/assets/:assetId",
    {
      preHandler: [...authHandlers, requirePermission("asset:read")],
    },
    async (request, reply) => {
      try {
        const params = parseParams<AssetIdParams>(request, assetIdParamsSchema);
        const result = await app.assetsService.getAsset(getAssetContext(request), params.assetId);
        return reply.send(result);
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );

  app.get(
    "/api/v2/assets/:assetId/download-url",
    {
      preHandler: [...authHandlers, requirePermission("asset:read")],
    },
    async (request, reply) => {
      try {
        const params = parseParams<AssetIdParams>(request, assetIdParamsSchema);
        const result = await app.assetsService.createDownloadUrl(
          getAssetContext(request),
          params.assetId,
        );
        return reply.send(result);
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );

  app.delete(
    "/api/v2/assets/:assetId",
    {
      preHandler: [...authHandlers, requirePermission("asset:delete")],
    },
    async (request, reply) => {
      try {
        const params = parseParams<AssetIdParams>(request, assetIdParamsSchema);
        const result = await app.assetsService.deleteAsset(getAssetContext(request), params.assetId);
        return reply.send(result);
      } catch (error) {
        return handleRouteError(error, request, reply);
      }
    },
  );
}
