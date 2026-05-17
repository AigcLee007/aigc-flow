import { createHash, randomBytes, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

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

function getJwtKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
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
  return new SignJWT({
    session_id: input.sessionId,
    tenant_id: input.tenantId,
    type: "access",
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(`${env.accessTokenTtlSeconds}s`)
    .setJti(randomUUID())
    .setSubject(input.userId)
    .sign(getJwtKey(env.jwtAccessSecret));
}

export async function verifyAccessToken(
  token: string,
  env: ApiEnv,
): Promise<AccessTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtKey(env.jwtAccessSecret), {
      algorithms: ["HS256"],
    });

    if (
      typeof payload.sub !== "string" ||
      typeof payload.session_id !== "string" ||
      payload.type !== "access"
    ) {
      return null;
    }

    const tenantId =
      typeof payload.tenant_id === "string" ? payload.tenant_id : payload.tenant_id === null
        ? null
        : null;
    const iat = normalizeNumericClaim(payload.iat);
    const exp = normalizeNumericClaim(payload.exp);
    if (iat === null || exp === null) {
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
