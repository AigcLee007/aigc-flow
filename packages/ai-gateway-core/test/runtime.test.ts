import { createServer } from "node:http";
import { once } from "node:events";

import { afterEach, describe, expect, test } from "vitest";

import { AiGateway } from "../src/ai-gateway.js";
import { AiGatewayError } from "../src/errors.js";
import { OpenAiCompatibleTextAdapter } from "../src/openai-compatible-text-adapter.js";
import { redactString, redactValue } from "../src/redaction.js";
import { RouteResolver } from "../src/route-resolver.js";
import type { ResolvedRoute } from "../src/types.js";

const openServers = new Set<ReturnType<typeof createServer>>();

async function withHttpServer(
  handler: Parameters<typeof createServer>[0],
): Promise<{ close: () => Promise<void>; url: string }> {
  const server = createServer(handler);
  openServers.add(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected an HTTP server address");
  }

  return {
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      openServers.delete(server);
    },
    url: `http://127.0.0.1:${address.port}`,
  };
}

afterEach(async () => {
  for (const server of openServers) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    openServers.delete(server);
  }
});

function makeRoute(overrides?: Partial<ResolvedRoute>): ResolvedRoute {
  return {
    baseUrl: overrides?.baseUrl ?? "http://localhost:1234",
    credential: overrides?.credential ?? {
      authTag: null,
      encryptedSecret: null,
      id: "credential-1",
      nonce: null,
    },
    model: overrides?.model ?? {
      id: "model-1",
      modelKey: "gpt-test",
    },
    priority: overrides?.priority ?? 100,
    provider: overrides?.provider ?? {
      defaultBaseUrl: "http://localhost:1234",
      id: "provider-1",
      key: "openai-compatible",
      kind: "openai-compatible",
    },
    requestConfig: overrides?.requestConfig ?? {},
    routeId: overrides?.routeId ?? "route-1",
    routeKey: overrides?.routeKey ?? "default",
    status: overrides?.status ?? "active",
    tenantId: overrides?.tenantId ?? null,
    weight: overrides?.weight ?? 100,
  };
}

describe("openai-compatible text adapter", () => {
  test("returns text and usage from a mock HTTP provider", async () => {
    const server = await withHttpServer(async (request, response) => {
      expect(request.url).toBe("/chat/completions");
      expect(request.headers.authorization).toBe("Bearer sk-test-secret");

      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.from(chunk));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        messages: Array<{ content: string }>;
        model: string;
      };

      expect(body.model).toBe("gpt-test");
      expect(body.messages[0]?.content).toBe("hello");

      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "mocked hello",
              },
            },
          ],
          usage: {
            completion_tokens: 2,
            prompt_tokens: 1,
            total_tokens: 3,
          },
        }),
      );
    });

    const adapter = new OpenAiCompatibleTextAdapter();
    const result = await adapter.generateText(
      {
        apiKey: "sk-test-secret",
        baseUrl: server.url,
        modelKey: "gpt-test",
        providerKey: "openai-compatible",
        requestConfig: {},
        routeId: "route-1",
        routeKey: "default",
        timeoutMs: 5_000,
      },
      {
        messages: [{ content: "hello", role: "user" }],
      },
    );

    expect(result).toMatchObject({
      modelKey: "gpt-test",
      outputText: "mocked hello",
      usage: {
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3,
      },
    });

    await server.close();
  });

  test("maps 401 to PROVIDER_AUTH_FAILED", async () => {
    const server = await withHttpServer((_request, response) => {
      response.statusCode = 401;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ error: { message: "bad key" } }));
    });

    const adapter = new OpenAiCompatibleTextAdapter();
    await expect(
      adapter.generateText(
        {
          apiKey: "sk-test-secret",
          baseUrl: server.url,
          modelKey: "gpt-test",
          providerKey: "openai-compatible",
          requestConfig: {},
          routeId: "route-1",
          routeKey: "default",
          timeoutMs: 5_000,
        },
        {
          messages: [{ content: "hello", role: "user" }],
        },
      ),
    ).rejects.toMatchObject<Partial<AiGatewayError>>({
      code: "PROVIDER_AUTH_FAILED",
    });

    await server.close();
  });

  test("maps 429 to PROVIDER_RATE_LIMIT", async () => {
    const server = await withHttpServer((_request, response) => {
      response.statusCode = 429;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ error: { message: "slow down" } }));
    });

    const adapter = new OpenAiCompatibleTextAdapter();
    await expect(
      adapter.generateText(
        {
          apiKey: "sk-test-secret",
          baseUrl: server.url,
          modelKey: "gpt-test",
          providerKey: "openai-compatible",
          requestConfig: {},
          routeId: "route-1",
          routeKey: "default",
          timeoutMs: 5_000,
        },
        {
          messages: [{ content: "hello", role: "user" }],
        },
      ),
    ).rejects.toMatchObject<Partial<AiGatewayError>>({
      code: "PROVIDER_RATE_LIMIT",
    });

    await server.close();
  });

  test("maps timeout to PROVIDER_TIMEOUT", async () => {
    const server = await withHttpServer(async (_request, _response) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const adapter = new OpenAiCompatibleTextAdapter();
    await expect(
      adapter.generateText(
        {
          apiKey: "sk-test-secret",
          baseUrl: server.url,
          modelKey: "gpt-test",
          providerKey: "openai-compatible",
          requestConfig: {},
          routeId: "route-1",
          routeKey: "default",
          timeoutMs: 10,
        },
        {
          messages: [{ content: "hello", role: "user" }],
        },
      ),
    ).rejects.toMatchObject<Partial<AiGatewayError>>({
      code: "PROVIDER_TIMEOUT",
    });

    await server.close();
  });
});

describe("redaction", () => {
  test("removes authorization headers and api keys", () => {
    const input = {
      authorization: "Bearer sk-secret-1234",
      encrypted_secret: "ciphertext",
      nested: {
        header: "Authorization: Bearer sk-secret-1234",
        token: "sk-secret-1234",
      },
    };

    expect(redactString("Bearer sk-secret-1234", ["sk-secret-1234"])).toContain("[REDACTED]");
    const redacted = redactValue(input, ["sk-secret-1234"]) as {
      authorization: string;
      encrypted_secret: string;
      nested: { header: string; token: string };
    };

    expect(redacted.authorization).toBe("[REDACTED]");
    expect(redacted.encrypted_secret).toBe("[REDACTED]");
    expect(redacted.nested.token).toBe("[REDACTED]");
    expect(redacted.nested.header).not.toContain("sk-secret-1234");
    expect(redacted.nested.header).toContain("[REDACTED]");
  });
});

describe("route resolver and ai gateway", () => {
  test("tenant route overrides system route for the same key", () => {
    const resolver = new RouteResolver();
    const selected = resolver.resolveTextRoute({
      routeKey: "shared",
      routes: [
        makeRoute({
          routeId: "system-route",
          routeKey: "shared",
          tenantId: null,
        }),
        makeRoute({
          priority: 200,
          routeId: "tenant-route",
          routeKey: "shared",
          tenantId: "tenant-a",
        }),
      ],
    });

    expect(selected.routeId).toBe("tenant-route");
  });

  test("ai gateway generateText delegates to the adapter for the selected route", async () => {
    const gateway = new AiGateway({
      "openai-compatible": {
        async generateText() {
          return {
            modelKey: "gpt-test",
            outputText: "hello from adapter",
            providerRequest: { ok: true },
            providerResponse: { ok: true },
            usage: {
              inputTokens: 1,
              outputTokens: 1,
              totalTokens: 2,
            },
          };
        },
      },
    });

    const result = await gateway.generateText({
      apiKey: "sk-test-secret",
      request: {
        messages: [{ content: "hello", role: "user" }],
      },
      route: makeRoute(),
    });

    expect(result).toMatchObject({
      modelKey: "gpt-test",
      outputText: "hello from adapter",
      providerKey: "openai-compatible",
      status: "succeeded",
    });
  });
});
