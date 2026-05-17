import { createPgPool, withTenantTransaction } from "@aigc-flow/db";
import {
  CredentialVault,
  type CredentialResponseView,
} from "@aigc-flow/ai-gateway-core";
import type { Pool, PoolClient } from "pg";

import type {
  CreateCredentialInput,
  CreateModelInput,
  CreateProviderInput,
  CreateRouteInput,
  UpdateCredentialInput,
  UpdateRouteInput,
} from "./ai-gateway.schemas.js";

type PgPool = Pool;

type TenantContext = {
  tenantId: string;
  userId: string | null;
};

type ProviderRecord = {
  capabilities: Record<string, unknown>;
  created_at: string;
  default_base_url: string | null;
  id: string;
  key: string;
  kind: string;
  name: string;
  status: string;
  updated_at: string;
};

type ModelRecord = {
  capabilities: Record<string, unknown>;
  context_window: number | null;
  created_at: string;
  display_name: string;
  id: string;
  modality: string;
  model_key: string;
  provider_id: string;
  status: string;
  updated_at: string;
};

type RouteRecord = {
  base_url_override: string | null;
  created_at: string;
  credential_id: string | null;
  fallback_group: string | null;
  id: string;
  modality: string;
  model_id: string | null;
  pricing: Record<string, unknown>;
  priority: number;
  provider_id: string;
  rate_limit: Record<string, unknown>;
  request_config: Record<string, unknown>;
  route_key: string;
  status: string;
  tenant_id: string | null;
  updated_at: string;
  weight: number;
};

type CredentialRecord = {
  auth_tag: Buffer;
  created_at: string;
  created_by: string | null;
  encrypted_secret: Buffer;
  id: string;
  key_version: string;
  last_used_at: string | null;
  name: string;
  nonce: Buffer;
  provider_id: string;
  rotated_at: string | null;
  secret_fingerprint: string;
  status: string;
  tenant_id: string | null;
  updated_at: string;
};

export type ProviderView = {
  capabilities: Record<string, unknown>;
  createdAt: string;
  defaultBaseUrl: string | null;
  id: string;
  key: string;
  kind: string;
  name: string;
  status: string;
  updatedAt: string;
};

export type ModelView = {
  capabilities: Record<string, unknown>;
  contextWindow: number | null;
  createdAt: string;
  displayName: string;
  id: string;
  modality: string;
  modelKey: string;
  providerId: string;
  status: string;
  updatedAt: string;
};

export type RouteView = {
  baseUrlOverride: string | null;
  createdAt: string;
  credentialId: string | null;
  fallbackGroup: string | null;
  id: string;
  modality: string;
  modelId: string | null;
  pricing: Record<string, unknown>;
  priority: number;
  providerId: string;
  rateLimit: Record<string, unknown>;
  requestConfig: Record<string, unknown>;
  routeKey: string;
  status: string;
  tenantId: string | null;
  updatedAt: string;
  weight: number;
};

export class AiGatewayApiError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "AiGatewayApiError";
    this.statusCode = statusCode;
  }
}

function mapProvider(row: ProviderRecord): ProviderView {
  return {
    capabilities: row.capabilities ?? {},
    createdAt: row.created_at,
    defaultBaseUrl: row.default_base_url,
    id: row.id,
    key: row.key,
    kind: row.kind,
    name: row.name,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

function mapModel(row: ModelRecord): ModelView {
  return {
    capabilities: row.capabilities ?? {},
    contextWindow: row.context_window,
    createdAt: row.created_at,
    displayName: row.display_name,
    id: row.id,
    modality: row.modality,
    modelKey: row.model_key,
    providerId: row.provider_id,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

function mapRoute(row: RouteRecord): RouteView {
  return {
    baseUrlOverride: row.base_url_override,
    createdAt: row.created_at,
    credentialId: row.credential_id,
    fallbackGroup: row.fallback_group,
    id: row.id,
    modality: row.modality,
    modelId: row.model_id,
    pricing: row.pricing ?? {},
    priority: row.priority,
    providerId: row.provider_id,
    rateLimit: row.rate_limit ?? {},
    requestConfig: row.request_config ?? {},
    routeKey: row.route_key,
    status: row.status,
    tenantId: row.tenant_id,
    updatedAt: row.updated_at,
    weight: row.weight,
  };
}

export class AiGatewayAdminService {
  readonly credentialVault: CredentialVault;
  readonly pool: PgPool;

  constructor(options: {
    credentialVault: CredentialVault;
    pool?: PgPool;
  }) {
    this.credentialVault = options.credentialVault;
    this.pool = options.pool ?? createPgPool();
  }

  async listProviders(): Promise<ProviderView[]> {
    const result = await this.pool.query<ProviderRecord>(
      `
        SELECT
          id::text AS id,
          key,
          name,
          kind,
          status,
          default_base_url,
          capabilities,
          created_at::text AS created_at,
          updated_at::text AS updated_at
        FROM ai_providers
        ORDER BY created_at ASC, id ASC
      `,
    );

    return result.rows.map(mapProvider);
  }

  async createProvider(input: CreateProviderInput): Promise<ProviderView> {
    try {
      const result = await this.pool.query<ProviderRecord>(
        `
          INSERT INTO ai_providers (
            key,
            name,
            kind,
            status,
            default_base_url,
            capabilities,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6::jsonb, now())
          RETURNING
            id::text AS id,
            key,
            name,
            kind,
            status,
            default_base_url,
            capabilities,
            created_at::text AS created_at,
            updated_at::text AS updated_at
        `,
        [
          input.key.trim(),
          input.name.trim(),
          input.kind.trim(),
          input.status?.trim() ?? "active",
          input.defaultBaseUrl?.trim() ?? null,
          JSON.stringify(input.capabilities ?? {}),
        ],
      );

      return mapProvider(result.rows[0]);
    } catch (error) {
      this.rethrowKnownDatabaseError(error, "Unable to create provider");
    }
  }

  async listModels(): Promise<ModelView[]> {
    const result = await this.pool.query<ModelRecord>(
      `
        SELECT
          id::text AS id,
          provider_id::text AS provider_id,
          model_key,
          display_name,
          modality,
          capabilities,
          context_window,
          status,
          created_at::text AS created_at,
          updated_at::text AS updated_at
        FROM ai_models
        ORDER BY created_at ASC, id ASC
      `,
    );

    return result.rows.map(mapModel);
  }

  async createModel(input: CreateModelInput): Promise<ModelView> {
    await this.ensureProviderExists(input.providerId);

    try {
      const result = await this.pool.query<ModelRecord>(
        `
          INSERT INTO ai_models (
            provider_id,
            model_key,
            display_name,
            modality,
            capabilities,
            context_window,
            status,
            updated_at
          )
          VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6::int, $7, now())
          RETURNING
            id::text AS id,
            provider_id::text AS provider_id,
            model_key,
            display_name,
            modality,
            capabilities,
            context_window,
            status,
            created_at::text AS created_at,
            updated_at::text AS updated_at
        `,
        [
          input.providerId,
          input.modelKey.trim(),
          input.displayName.trim(),
          input.modality.trim(),
          JSON.stringify(input.capabilities ?? {}),
          input.contextWindow ?? null,
          input.status?.trim() ?? "active",
        ],
      );

      return mapModel(result.rows[0]);
    } catch (error) {
      this.rethrowKnownDatabaseError(error, "Unable to create model");
    }
  }

  async listRoutes(context: TenantContext): Promise<RouteView[]> {
    return withTenantTransaction(context, async (client) => {
      const result = await client.query<RouteRecord>(
        `
          SELECT
            id::text AS id,
            tenant_id::text AS tenant_id,
            provider_id::text AS provider_id,
            model_id::text AS model_id,
            credential_id::text AS credential_id,
            route_key,
            modality,
            priority,
            weight,
            fallback_group,
            base_url_override,
            request_config,
            pricing,
            rate_limit,
            status,
            created_at::text AS created_at,
            updated_at::text AS updated_at
          FROM ai_routes
          ORDER BY route_key ASC, created_at ASC
        `,
      );

      return result.rows.map(mapRoute);
    }, this.pool);
  }

  async createRoute(context: TenantContext, input: CreateRouteInput): Promise<RouteView> {
    return withTenantTransaction(context, async (client) => {
      await this.ensureProviderExists(input.providerId, client);
      if (input.modelId) {
        await this.ensureModelExists(input.modelId, client);
      }
      if (input.credentialId) {
        await this.ensureCredentialExists(input.credentialId, client);
      }

      try {
        const result = await client.query<RouteRecord>(
          `
            INSERT INTO ai_routes (
              tenant_id,
              provider_id,
              model_id,
              credential_id,
              route_key,
              modality,
              priority,
              weight,
              fallback_group,
              base_url_override,
              request_config,
              pricing,
              rate_limit,
              status,
              updated_at
            )
            VALUES (
              $1::uuid,
              $2::uuid,
              $3::uuid,
              $4::uuid,
              $5,
              $6,
              $7::int,
              $8::int,
              $9,
              $10,
              $11::jsonb,
              $12::jsonb,
              $13::jsonb,
              $14,
              now()
            )
            RETURNING
              id::text AS id,
              tenant_id::text AS tenant_id,
              provider_id::text AS provider_id,
              model_id::text AS model_id,
              credential_id::text AS credential_id,
              route_key,
              modality,
              priority,
              weight,
              fallback_group,
              base_url_override,
              request_config,
              pricing,
              rate_limit,
              status,
              created_at::text AS created_at,
              updated_at::text AS updated_at
          `,
          [
            context.tenantId,
            input.providerId,
            input.modelId ?? null,
            input.credentialId ?? null,
            input.routeKey.trim(),
            input.modality.trim(),
            input.priority ?? 100,
            input.weight ?? 100,
            input.fallbackGroup?.trim() ?? null,
            input.baseUrlOverride?.trim() ?? null,
            JSON.stringify(input.requestConfig ?? {}),
            JSON.stringify(input.pricing ?? {}),
            JSON.stringify(input.rateLimit ?? {}),
            input.status?.trim() ?? "active",
          ],
        );

        return mapRoute(result.rows[0]);
      } catch (error) {
        this.rethrowKnownDatabaseError(error, "Unable to create route");
      }
    }, this.pool);
  }

  async updateRoute(
    context: TenantContext,
    routeId: string,
    input: UpdateRouteInput,
  ): Promise<RouteView> {
    return withTenantTransaction(context, async (client) => {
      const existing = await this.getRouteRow(client, routeId);
      if (input.modelId) {
        await this.ensureModelExists(input.modelId, client);
      }
      if (input.credentialId) {
        await this.ensureCredentialExists(input.credentialId, client);
      }

      const result = await client.query<RouteRecord>(
        `
          UPDATE ai_routes
          SET
            model_id = $2::uuid,
            credential_id = $3::uuid,
            priority = $4::int,
            weight = $5::int,
            fallback_group = $6,
            base_url_override = $7,
            request_config = $8::jsonb,
            pricing = $9::jsonb,
            rate_limit = $10::jsonb,
            status = $11,
            updated_at = now()
          WHERE id = $1::uuid
          RETURNING
            id::text AS id,
            tenant_id::text AS tenant_id,
            provider_id::text AS provider_id,
            model_id::text AS model_id,
            credential_id::text AS credential_id,
            route_key,
            modality,
            priority,
            weight,
            fallback_group,
            base_url_override,
            request_config,
            pricing,
            rate_limit,
            status,
            created_at::text AS created_at,
            updated_at::text AS updated_at
        `,
        [
          routeId,
          input.modelId !== undefined ? input.modelId : existing.model_id,
          input.credentialId !== undefined ? input.credentialId : existing.credential_id,
          input.priority ?? existing.priority,
          input.weight ?? existing.weight,
          input.fallbackGroup !== undefined ? input.fallbackGroup?.trim() ?? null : existing.fallback_group,
          input.baseUrlOverride !== undefined ? input.baseUrlOverride?.trim() ?? null : existing.base_url_override,
          JSON.stringify(input.requestConfig ?? existing.request_config),
          JSON.stringify(input.pricing ?? existing.pricing),
          JSON.stringify(input.rateLimit ?? existing.rate_limit),
          input.status?.trim() ?? existing.status,
        ],
      );

      const row = result.rows[0];
      if (!row) {
        throw new AiGatewayApiError(404, "ROUTE_NOT_FOUND", "Route not found");
      }

      return mapRoute(row);
    }, this.pool);
  }

  async listCredentials(context: TenantContext): Promise<CredentialResponseView[]> {
    return withTenantTransaction(context, async (client) => {
      const result = await client.query<CredentialRecord>(
        `
          SELECT
            id::text AS id,
            tenant_id::text AS tenant_id,
            provider_id::text AS provider_id,
            name,
            encrypted_secret,
            nonce,
            auth_tag,
            key_version,
            secret_fingerprint,
            status,
            last_used_at::text AS last_used_at,
            rotated_at::text AS rotated_at,
            created_by::text AS created_by,
            created_at::text AS created_at,
            updated_at::text AS updated_at
          FROM api_credentials
          WHERE status <> 'deleted'
          ORDER BY created_at ASC, id ASC
        `,
      );

      return result.rows.map((row) => this.mapCredential(row));
    }, this.pool);
  }

  async createCredential(
    context: TenantContext,
    input: CreateCredentialInput,
  ): Promise<CredentialResponseView> {
    return withTenantTransaction(context, async (client) => {
      await this.ensureProviderExists(input.providerId, client);
      const encrypted = this.credentialVault.createCredential(input.secret);

      try {
        const result = await client.query<CredentialRecord>(
          `
            INSERT INTO api_credentials (
              tenant_id,
              provider_id,
              name,
              encrypted_secret,
              nonce,
              auth_tag,
              key_version,
              secret_fingerprint,
              status,
              created_by,
              updated_at
            )
            VALUES (
              $1::uuid,
              $2::uuid,
              $3,
              $4::bytea,
              $5::bytea,
              $6::bytea,
              $7,
              $8,
              $9,
              $10::uuid,
              now()
            )
            RETURNING
              id::text AS id,
              tenant_id::text AS tenant_id,
              provider_id::text AS provider_id,
              name,
              encrypted_secret,
              nonce,
              auth_tag,
              key_version,
              secret_fingerprint,
              status,
              last_used_at::text AS last_used_at,
              rotated_at::text AS rotated_at,
              created_by::text AS created_by,
              created_at::text AS created_at,
              updated_at::text AS updated_at
          `,
          [
            context.tenantId,
            input.providerId,
            input.name.trim(),
            encrypted.encryptedSecret,
            encrypted.nonce,
            encrypted.authTag,
            encrypted.keyVersion,
            encrypted.secretFingerprint,
            input.status?.trim() ?? "active",
            context.userId,
          ],
        );

        return this.mapCredential(result.rows[0]);
      } catch (error) {
        this.rethrowKnownDatabaseError(error, "Unable to create credential");
      }
    }, this.pool);
  }

  async updateCredential(
    context: TenantContext,
    credentialId: string,
    input: UpdateCredentialInput,
  ): Promise<CredentialResponseView> {
    return withTenantTransaction(context, async (client) => {
      const existing = await this.getCredentialRow(client, credentialId);
      const result = await client.query<CredentialRecord>(
        `
          UPDATE api_credentials
          SET
            name = $2,
            status = $3,
            updated_at = now()
          WHERE id = $1::uuid
          RETURNING
            id::text AS id,
            tenant_id::text AS tenant_id,
            provider_id::text AS provider_id,
            name,
            encrypted_secret,
            nonce,
            auth_tag,
            key_version,
            secret_fingerprint,
            status,
            last_used_at::text AS last_used_at,
            rotated_at::text AS rotated_at,
            created_by::text AS created_by,
            created_at::text AS created_at,
            updated_at::text AS updated_at
        `,
        [
          credentialId,
          input.name?.trim() ?? existing.name,
          input.status?.trim() ?? existing.status,
        ],
      );

      return this.mapCredential(result.rows[0]);
    }, this.pool);
  }

  async rotateCredential(
    context: TenantContext,
    credentialId: string,
    secret: string,
  ): Promise<CredentialResponseView> {
    return withTenantTransaction(context, async (client) => {
      await this.getCredentialRow(client, credentialId);
      const encrypted = this.credentialVault.rotateCredential(secret);
      const result = await client.query<CredentialRecord>(
        `
          UPDATE api_credentials
          SET
            encrypted_secret = $2::bytea,
            nonce = $3::bytea,
            auth_tag = $4::bytea,
            key_version = $5,
            secret_fingerprint = $6,
            rotated_at = now(),
            status = 'active',
            updated_at = now()
          WHERE id = $1::uuid
          RETURNING
            id::text AS id,
            tenant_id::text AS tenant_id,
            provider_id::text AS provider_id,
            name,
            encrypted_secret,
            nonce,
            auth_tag,
            key_version,
            secret_fingerprint,
            status,
            last_used_at::text AS last_used_at,
            rotated_at::text AS rotated_at,
            created_by::text AS created_by,
            created_at::text AS created_at,
            updated_at::text AS updated_at
        `,
        [
          credentialId,
          encrypted.encryptedSecret,
          encrypted.nonce,
          encrypted.authTag,
          encrypted.keyVersion,
          encrypted.secretFingerprint,
        ],
      );

      return this.mapCredential(result.rows[0]);
    }, this.pool);
  }

  async deleteCredential(context: TenantContext, credentialId: string): Promise<{ ok: true }> {
    return withTenantTransaction(context, async (client) => {
      const result = await client.query<{ id: string }>(
        `
          UPDATE api_credentials
          SET status = 'deleted', updated_at = now()
          WHERE id = $1::uuid
            AND status <> 'deleted'
          RETURNING id::text AS id
        `,
        [credentialId],
      );

      if (!result.rows[0]?.id) {
        throw new AiGatewayApiError(404, "CREDENTIAL_NOT_FOUND", "Credential not found");
      }

      return { ok: true as const };
    }, this.pool);
  }

  private async ensureProviderExists(providerId: string, client?: PoolClient): Promise<void> {
    const executor = client ?? this.pool;
    const result = await executor.query<{ id: string }>(
      `
        SELECT id::text AS id
        FROM ai_providers
        WHERE id = $1::uuid
        LIMIT 1
      `,
      [providerId],
    );

    if (!result.rows[0]?.id) {
      throw new AiGatewayApiError(404, "PROVIDER_NOT_FOUND", "Provider not found");
    }
  }

  private async ensureModelExists(modelId: string, client: PoolClient): Promise<void> {
    const result = await client.query<{ id: string }>(
      `
        SELECT id::text AS id
        FROM ai_models
        WHERE id = $1::uuid
        LIMIT 1
      `,
      [modelId],
    );

    if (!result.rows[0]?.id) {
      throw new AiGatewayApiError(404, "MODEL_NOT_FOUND", "Model not found");
    }
  }

  private async ensureCredentialExists(credentialId: string, client: PoolClient): Promise<void> {
    const result = await client.query<{ id: string }>(
      `
        SELECT id::text AS id
        FROM api_credentials
        WHERE id = $1::uuid
          AND status <> 'deleted'
        LIMIT 1
      `,
      [credentialId],
    );

    if (!result.rows[0]?.id) {
      throw new AiGatewayApiError(404, "CREDENTIAL_NOT_FOUND", "Credential not found");
    }
  }

  private async getRouteRow(client: PoolClient, routeId: string): Promise<RouteRecord> {
    const result = await client.query<RouteRecord>(
      `
        SELECT
          id::text AS id,
          tenant_id::text AS tenant_id,
          provider_id::text AS provider_id,
          model_id::text AS model_id,
          credential_id::text AS credential_id,
          route_key,
          modality,
          priority,
          weight,
          fallback_group,
          base_url_override,
          request_config,
          pricing,
          rate_limit,
          status,
          created_at::text AS created_at,
          updated_at::text AS updated_at
        FROM ai_routes
        WHERE id = $1::uuid
        LIMIT 1
      `,
      [routeId],
    );

    const row = result.rows[0];
    if (!row) {
      throw new AiGatewayApiError(404, "ROUTE_NOT_FOUND", "Route not found");
    }

    return row;
  }

  private async getCredentialRow(
    client: PoolClient,
    credentialId: string,
  ): Promise<CredentialRecord> {
    const result = await client.query<CredentialRecord>(
      `
        SELECT
          id::text AS id,
          tenant_id::text AS tenant_id,
          provider_id::text AS provider_id,
          name,
          encrypted_secret,
          nonce,
          auth_tag,
          key_version,
          secret_fingerprint,
          status,
          last_used_at::text AS last_used_at,
          rotated_at::text AS rotated_at,
          created_by::text AS created_by,
          created_at::text AS created_at,
          updated_at::text AS updated_at
        FROM api_credentials
        WHERE id = $1::uuid
          AND status <> 'deleted'
        LIMIT 1
      `,
      [credentialId],
    );

    const row = result.rows[0];
    if (!row) {
      throw new AiGatewayApiError(404, "CREDENTIAL_NOT_FOUND", "Credential not found");
    }

    return row;
  }

  private mapCredential(row: CredentialRecord): CredentialResponseView {
    const secret = this.credentialVault.getSecretForProviderCall({
      authTag: row.auth_tag,
      encryptedSecret: row.encrypted_secret,
      nonce: row.nonce,
    });

    return this.credentialVault.maskCredentialForResponse({
      createdAt: row.created_at,
      id: row.id,
      lastUsedAt: row.last_used_at,
      name: row.name,
      providerId: row.provider_id,
      rotatedAt: row.rotated_at,
      secret,
      status: row.status,
    });
  }

  private rethrowKnownDatabaseError(error: unknown, fallbackMessage: string): never {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      throw new AiGatewayApiError(409, "CONFLICT", "A record with the same unique value already exists");
    }

    if (error instanceof AiGatewayApiError) {
      throw error;
    }

    throw new Error(fallbackMessage);
  }
}
