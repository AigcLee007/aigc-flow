const SENSITIVE_KEYS = new Set([
  "api_key",
  "apikey",
  "auth_tag",
  "authorization",
  "bearer",
  "encrypted_secret",
  "nonce",
  "password_hash",
  "token_hash",
]);

function redactBearerTokens(input: string): string {
  return input.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]");
}

function redactAuthorizationHeaders(input: string): string {
  const withColonHeaders = input.replace(
    /(Authorization\s*:\s*)Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
    "$1Bearer [REDACTED]",
  );

  return withColonHeaders.replace(
    /(authorization["']?\s*[:=]\s*["']?)(?!Bearer \[REDACTED\])([^"',}\]]+)/gi,
    "$1[REDACTED]",
  );
}

function redactSecrets(input: string, secrets: string[]): string {
  let result = input;
  for (const secret of secrets) {
    if (!secret) {
      continue;
    }

    result = result.split(secret).join("[REDACTED]");
  }
  return result;
}

export function redactString(input: string, secrets: string[] = []): string {
  return redactSecrets(
    redactAuthorizationHeaders(redactBearerTokens(input)),
    secrets,
  );
}

export function redactValue(value: unknown, secrets: string[] = []): unknown {
  if (typeof value === "string") {
    return redactString(value, secrets);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, secrets));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      output[key] = "[REDACTED]";
      continue;
    }

    output[key] = redactValue(entry, secrets);
  }

  return output;
}
