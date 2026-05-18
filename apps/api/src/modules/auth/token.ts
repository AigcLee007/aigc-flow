import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import type { ApiEnv } from "../../config/env.js";

export type AccessTokenClaims = {
  exp: number;
  iat: number;
  jti: string;
  session_id: string;
  sub: string;
  tenant_id: string | null;
  type: "access";
};

function base64urlJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signJwtPayload(payload: Record<string, unknown>, secret: string): string {
  const header = base64urlJson({ alg: "HS256", typ: "JWT" });
  const body = base64urlJson(payload);
  const signingInput = `${header}.${body}`;
  const signature = createHmac("sha256", secret).update(signingInput).digest("base64url");

  return `${signingInput}.${signature}`;
}

function decodeJwtPayload(token: string, secret: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  const [header, body, signature] = parts;
  const signingInput = `${header}.${body}`;
  const expected = createHmac("sha256", secret).update(signingInput).digest("base64url");

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function normalizeNumericClaim(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

export async function signAccessToken(
  input: {
    sessionId: string;
    tenantId: string | null;
    userId: string;
  },
  env: ApiEnv,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  return signJwtPayload(
    {
      exp: now + env.accessTokenTtlSeconds,
      iat: now,
      jti: randomUUID(),
      session_id: input.sessionId,
      sub: input.userId,
      tenant_id: input.tenantId,
      type: "access",
    },
    env.jwtAccessSecret,
  );
}

export async function verifyAccessToken(
  token: string,
  env: ApiEnv,
): Promise<AccessTokenClaims | null> {
  try {
    const payload = decodeJwtPayload(token, env.jwtAccessSecret);
    if (!payload) {
      return null;
    }

    if (
      typeof payload.sub !== "string" ||
      typeof payload.session_id !== "string" ||
      payload.type !== "access"
    ) {
      return null;
    }

    const tenantId =
      typeof payload.tenant_id === "string"
        ? payload.tenant_id
        : payload.tenant_id === null
          ? null
          : null;

    const iat = normalizeNumericClaim(payload.iat);
    const exp = normalizeNumericClaim(payload.exp);
    if (iat === null || exp === null) {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    if (exp <= now) {
      return null;
    }

    return {
      exp,
      iat,
      jti: typeof payload.jti === "string" ? payload.jti : "",
      session_id: payload.session_id,
      sub: payload.sub,
      tenant_id: tenantId,
      type: "access",
    };
  } catch {
    return null;
  }
}

export function generateRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
