import type { Pool } from "pg";

import { createPgPool, withTenantTransaction } from "@aigc-flow/db";

import { AiGateway } from "./ai-gateway.js";
import { CredentialVault } from "./credential-vault.js";
import { AiGatewayError } from "./errors.js";
import { redactValue } from "./redaction.js";
import { RouteResolver } from "./route-resolver.js";
import type {
  AiGatewayMediaResult,
  ImageGenerationRequest,
  PollTaskRequest,
  ProviderTaskResult,
  ResolvedRoute,
  VideoGenerationRequest,
} from "./types.js";

type RuntimeContext = {
  tenantId: string;
  userId: string | null;
};

type RuntimeRouteRecord = {
  auth_tag: Buffer | null;
  base_url_override: string | null;
  credential_id: string | null;
  default_base_url: string | null;
  encrypted_secret: Buffer | null;
  model_id: string | null;
  model_key: string | null;
  nonce: Buffer | null;
  priority: number;
  provider_id: string;
  provider_key: string;
  provider_kind: string;
  request_config: Record<string, unknown>;
  route_id: string;
  route_key: string;
  route_status: string;
  route_tenant_id: string | null;
  weight: number;
};

type AiCallLogInsertInput = {
  error: Record<string, unknown> | null;
  inputTokens?: number | null;
  latencyMs?: number | null;
  modelId: string | null;
  nodeRunId?: string | null;
  outputTokens?: number | null;
  providerId: string | null;
  requestAssetId?: string | null;
  responseAssetId?: string | null;
  routeId: string | null;
  status: string;
  tenantId: string;
  workflowRunId?: string | null;
};

export class DatabaseMediaRuntime {
  readonly aiGateway: AiGateway;
  readonly credentialVault: CredentialVault;
  readonly pool: Pool;
  readonly routeResolver: RouteResolver;

  constructor(options: {
    aiGateway: AiGateway;
    credentialVault: CredentialVault;
    pool?: Pool;
    routeResolver?: RouteResolver;
  }) {
    this.aiGateway = options.aiGateway;
    this.credentialVault = options.credentialVault;
    this.pool = options.pool ?? createPgPool();
    this.routeResolver = options.routeResolver ?? new RouteResolver();
  }

  async generateImage(
    context: RuntimeContext,
    request: ImageGenerationRequest,
    metadata?: {
      nodeRunId?: string | null;
      workflowRunId?: string | null;
    },
  ): Promise<AiGatewayMediaResult> {
    return this.callGenerate(
      context,
      "image",
      request.routeKey ?? null,
      metadata,
      (selectedRoute, apiKey) =>
        this.aiGateway.generateImage({
          apiKey,
          request,
          route: selectedRoute,
        }),
    );
  }

  async generateVideo(
    context: RuntimeContext,
    request: VideoGenerationRequest,
    metadata?: {
      nodeRunId?: string | null;
      workflowRunId?: string | null;
    },
  ): Promise<AiGatewayMediaResult> {
    return this.callGenerate(
      context,
      "video",
      request.routeKey ?? null,
      metadata,
      (selectedRoute, apiKey) =>
        this.aiGateway.generateVideo({
          apiKey,
          request,
          route: selectedRoute,
        }),
    );
  }

  async pollTask(
    context: RuntimeContext,
    modality: "image" | "video",
    request: PollTaskRequest,
    metadata?: {
      nodeRunId?: string | null;
      workflowRunId?: string | null;
    },
  ): Promise<ProviderTaskResult> {
    const selectedRoute = request.routeId
      ? await this.getRuntimeRouteById(context, request.routeId)
      : await this.resolveRoute(context, modality, request.routeKey ?? null);

    const apiKey = this.getApiKeyForRoute(selectedRoute);
    const startedAt = Date.now();

    try {
      const result = await this.aiGateway.pollTask({
        apiKey,
        request,
        route: selectedRoute,
      });

      const normalizedStatus = result.status === "failed" ? "failed" : "succeeded";
      await this.insertAiCallLog({
        error:
          result.status === "failed"
            ? {
                ...(result.error ?? {}),
                providerRequest: redactValue(result.providerRequest, [apiKey]),
                providerResponse: redactValue(result.providerResponse, [apiKey]),
              }
            : null,
        inputTokens: result.usage?.inputTokens ?? null,
        latencyMs: Date.now() - startedAt,
        modelId: selectedRoute.model.id,
        nodeRunId: metadata?.nodeRunId ?? null,
        outputTokens: result.usage?.outputTokens ?? null,
        providerId: selectedRoute.provider.id,
        routeId: selectedRoute.routeId,
        status: normalizedStatus,
        tenantId: context.tenantId,
        workflowRunId: metadata?.workflowRunId ?? null,
      });

      return result;
    } catch (error) {
      const normalizedError = this.toAiGatewayError(error);
      await this.insertAiCallLog({
        error: {
          code: normalizedError.code,
          message: normalizedError.message,
          providerRequest: redactValue(normalizedError.providerRequest, [apiKey]),
          providerResponse: redactValue(normalizedError.providerResponse, [apiKey]),
        },
        latencyMs: Date.now() - startedAt,
        modelId: selectedRoute.model.id,
        nodeRunId: metadata?.nodeRunId ?? null,
        providerId: selectedRoute.provider.id,
        routeId: selectedRoute.routeId,
        status: "failed",
        tenantId: context.tenantId,
        workflowRunId: metadata?.workflowRunId ?? null,
      });
      throw normalizedError;
    }
  }

  private async callGenerate(
    context: RuntimeContext,
    modality: "image" | "video",
    routeKey: string | null,
    metadata: {
      nodeRunId?: string | null;
      workflowRunId?: string | null;
    } | undefined,
    caller: (selectedRoute: ResolvedRoute, apiKey: string) => Promise<AiGatewayMediaResult>,
  ): Promise<AiGatewayMediaResult> {
    const selectedRoute = await this.resolveRoute(context, modality, routeKey);
    const apiKey = this.getApiKeyForRoute(selectedRoute);
    const startedAt = Date.now();

    try {
      const result = await caller(selectedRoute, apiKey);

      await this.insertAiCallLog({
        error: null,
        inputTokens: result.usage?.inputTokens ?? null,
        latencyMs: Date.now() - startedAt,
        modelId: selectedRoute.model.id,
        nodeRunId: metadata?.nodeRunId ?? null,
        outputTokens: result.usage?.outputTokens ?? null,
        providerId: selectedRoute.provider.id,
        routeId: selectedRoute.routeId,
        status: result.status === "failed" ? "failed" : "succeeded",
        tenantId: context.tenantId,
        workflowRunId: metadata?.workflowRunId ?? null,
      });

      return result;
    } catch (error) {
      const normalizedError = this.toAiGatewayError(error);
      await this.insertAiCallLog({
        error: {
          code: normalizedError.code,
          message: normalizedError.message,
          providerRequest: redactValue(normalizedError.providerRequest, [apiKey]),
          providerResponse: redactValue(normalizedError.providerResponse, [apiKey]),
        },
        latencyMs: Date.now() - startedAt,
        modelId: selectedRoute.model.id,
        nodeRunId: metadata?.nodeRunId ?? null,
        providerId: selectedRoute.provider.id,
        routeId: selectedRoute.routeId,
        status: "failed",
        tenantId: context.tenantId,
        workflowRunId: metadata?.workflowRunId ?? null,
      });
      throw normalizedError;
    }
  }

  private getApiKeyForRoute(selectedRoute: ResolvedRoute): string {
    if (
      !selectedRoute.credential.id ||
      !selectedRoute.credential.encryptedSecret ||
      !selectedRoute.credential.nonce ||
      !selectedRoute.credential.authTag
    ) {
      throw new AiGatewayError({
        code: "CREDENTIAL_REQUIRED",
        message: "The selected route does not have a usable credential",
        statusCode: 400,
      });
    }

    return this.credentialVault.getSecretForProviderCall({
      authTag: selectedRoute.credential.authTag,
      encryptedSecret: selectedRoute.credential.encryptedSecret,
      nonce: selectedRoute.credential.nonce,
    });
  }

  private async resolveRoute(
    context: RuntimeContext,
    modality: "image" | "video",
    routeKey: string | null,
  ): Promise<ResolvedRoute> {
    const routes = await this.listRuntimeRoutes(context, modality, {
      routeKey,
    });

    return this.routeResolver.resolveMediaRoute({
      routeKey,
      routes,
    });
  }

  private async getRuntimeRouteById(
    context: RuntimeContext,
    routeId: string,
  ): Promise<ResolvedRoute> {
    const routes = await this.listRuntimeRoutes(context, null, {
      routeId,
    });
    const route = routes[0];
    if (!route) {
      throw new AiGatewayError({
        code: "ROUTE_NOT_FOUND",
        message: "The provider task route is no longer available",
        statusCode: 404,
      });
    }

    return route;
  }

  private async listRuntimeRoutes(
    context: RuntimeContext,
    modality: "image" | "video" | null,
    options: {
      routeId?: string | null;
      routeKey?: string | null;
    },
  ): Promise<ResolvedRoute[]> {
    return withTenantTransaction(context, async (client) => {
      const result = await client.query<RuntimeRouteRecord>(
        `
          SELECT
            r.id::text AS route_id,
            r.tenant_id::text AS route_tenant_id,
            r.route_key,
            r.status AS route_status,
            r.priority,
            r.weight,
            r.base_url_override,
            r.request_config,
            p.id::text AS provider_id,
            p.key AS provider_key,
            p.kind AS provider_kind,
            p.default_base_url,
            m.id::text AS model_id,
            m.model_key,
            c.id::text AS credential_id,
            c.encrypted_secret,
            c.nonce,
            c.auth_tag
          FROM ai_routes r
          JOIN ai_providers p
            ON p.id = r.provider_id
          LEFT JOIN ai_models m
            ON m.id = r.model_id
          LEFT JOIN api_credentials c
            ON c.id = r.credential_id
           AND c.status <> 'deleted'
          WHERE ($1::text IS NULL OR r.modality = $1)
            AND r.status = 'active'
            AND p.status = 'active'
            AND ($2::uuid IS NULL OR r.id = $2::uuid)
            AND ($3::text IS NULL OR r.route_key = $3)
            AND (r.model_id IS NULL OR m.status = 'active')
          ORDER BY
            CASE WHEN r.tenant_id IS NULL THEN 1 ELSE 0 END ASC,
            r.priority ASC,
            r.weight DESC,
            r.created_at ASC,
            r.id ASC
        `,
        [modality, options.routeId ?? null, options.routeKey?.trim() || null],
      );

      return result.rows.map((row) => {
        const baseUrl = row.base_url_override?.trim() || row.default_base_url?.trim() || "";
        if (!baseUrl) {
          throw new AiGatewayError({
            code: "PROVIDER_BAD_REQUEST",
            message: `Route ${row.route_key} does not have a provider base URL configured`,
            statusCode: 400,
          });
        }

        return {
          baseUrl,
          credential: {
            authTag: row.auth_tag,
            encryptedSecret: row.encrypted_secret,
            id: row.credential_id,
            nonce: row.nonce,
          },
          model: {
            id: row.model_id,
            modelKey: row.model_key,
          },
          priority: row.priority,
          provider: {
            defaultBaseUrl: row.default_base_url,
            id: row.provider_id,
            key: row.provider_key,
            kind: row.provider_kind,
          },
          requestConfig: row.request_config ?? {},
          routeId: row.route_id,
          routeKey: row.route_key,
          status: row.route_status,
          tenantId: row.route_tenant_id,
          weight: row.weight,
        } satisfies ResolvedRoute;
      });
    }, this.pool);
  }

  private async insertAiCallLog(input: AiCallLogInsertInput): Promise<void> {
    await withTenantTransaction(
      { tenantId: input.tenantId, userId: null },
      async (client) => {
        await client.query(
          `
            INSERT INTO ai_call_logs (
              tenant_id,
              workflow_run_id,
              node_run_id,
              provider_id,
              model_id,
              route_id,
              status,
              request_asset_id,
              response_asset_id,
              error,
              latency_ms,
              input_tokens,
              output_tokens
            )
            VALUES (
              $1::uuid,
              $2::uuid,
              $3::uuid,
              $4::uuid,
              $5::uuid,
              $6::uuid,
              $7,
              $8::uuid,
              $9::uuid,
              $10::jsonb,
              $11::int,
              $12::int,
              $13::int
            )
          `,
          [
            input.tenantId,
            input.workflowRunId ?? null,
            input.nodeRunId ?? null,
            input.providerId,
            input.modelId,
            input.routeId,
            input.status,
            input.requestAssetId ?? null,
            input.responseAssetId ?? null,
            input.error ? JSON.stringify(input.error) : null,
            input.latencyMs ?? null,
            input.inputTokens ?? null,
            input.outputTokens ?? null,
          ],
        );
      },
      this.pool,
    );
  }

  private toAiGatewayError(error: unknown): AiGatewayError {
    if (error instanceof AiGatewayError) {
      return error;
    }

    return new AiGatewayError({
      code: "PROVIDER_INTERNAL_ERROR",
      details: error instanceof Error ? error.message : String(error),
      message: "The provider call failed unexpectedly",
      statusCode: 502,
    });
  }
}
