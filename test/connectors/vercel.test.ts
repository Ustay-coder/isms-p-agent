import assert from "node:assert/strict";
import test from "node:test";
import { scanVercel } from "../../src/connectors/vercel.js";

const TOKEN = "vercel_secret_token_value";

test("scanVercel emits project metadata without returning token or environment values", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(url), init });
    const parsed = new URL(String(url));

    if (parsed.pathname === "/v9/projects/my-app") {
      return jsonResponse({ id: "prj_123", name: "my-app" });
    }
    if (parsed.pathname === "/v9/projects/my-app/domains") {
      return jsonResponse({ domains: [{ name: "app.example.com" }, { name: "preview.example.com" }] });
    }
    if (parsed.pathname === "/v6/deployments") {
      return jsonResponse({ deployments: [{ state: "READY", target: "production", url: "app.example.com" }] });
    }
    if (parsed.pathname === "/v10/projects/my-app/env") {
      return jsonResponse({ envs: [{ key: "DATABASE_URL", value: "postgres://secret" }, { key: "SESSION_SECRET", value: "secret" }] });
    }
    return jsonResponse({ error: { message: "not found" } }, 404);
  };

  const signals = await scanVercel({ project: "my-app", token: TOKEN }, fetchMock);
  const serialized = JSON.stringify(signals);

  assert.equal(signals.find((signal) => signal.id === "vercel:project")?.metadata.exists, true);
  assert.equal(signals.find((signal) => signal.id === "vercel:production-domains")?.metadata.domainCount, 2);
  assert.equal(signals.find((signal) => signal.id === "vercel:latest-deployment")?.metadata.state, "READY");
  assert.deepEqual(signals.find((signal) => signal.id === "vercel:environment-variables")?.metadata.envVarNames, ["DATABASE_URL", "SESSION_SECRET"]);

  assert.doesNotMatch(serialized, new RegExp(TOKEN));
  assert.doesNotMatch(serialized, /postgres:\/\/secret/);
  assert.doesNotMatch(serialized, /app\.example\.com/);
  for (const call of calls) {
    assert.equal((call.init?.headers as Record<string, string>).Authorization, `Bearer ${TOKEN}`);
    assert.doesNotMatch(call.url, new RegExp(TOKEN));
  }
});

test("scanVercel turns API failures into needs_confirmation signals", async () => {
  const signals = await scanVercel({ project: "my-app", token: TOKEN }, async () => jsonResponse({ error: { message: "denied" } }, 401));

  assert.equal(signals.every((signal) => signal.basis === "needs_confirmation"), true);
  assert.match(signals.map((signal) => signal.summary).join("\n"), /Vercel API returned 401/);
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
