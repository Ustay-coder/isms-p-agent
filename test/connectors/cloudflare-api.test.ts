import assert from "node:assert/strict";
import test from "node:test";
import { CloudflareApiClient } from "../../src/connectors/cloudflare-api.js";

const TOKEN = "cloudflare_secret_token_value";

test("CloudflareApiClient sends token only in Authorization header and uses GET", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(url), init });
    return jsonResponse({ success: true, result: { ok: true } });
  };

  const client = new CloudflareApiClient(TOKEN, fetchMock);
  const result = await client.get("/zones/zone_123/settings/ssl");

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.init?.method, "GET");
  assert.equal((calls[0]?.init?.headers as Record<string, string>).Authorization, `Bearer ${TOKEN}`);
  assert.doesNotMatch(calls[0]?.url ?? "", new RegExp(TOKEN));
});

test("CloudflareApiClient paginates list responses deterministically", async () => {
  const pages: number[] = [];
  const fetchMock = async (url: string | URL | Request): Promise<Response> => {
    const parsed = new URL(String(url));
    const page = Number(parsed.searchParams.get("page") ?? "1");
    pages.push(page);
    return jsonResponse({
      success: true,
      result: [`item-${page}`],
      result_info: { page, per_page: 1, total_pages: 3, count: 1, total_count: 3 }
    });
  };

  const client = new CloudflareApiClient(TOKEN, fetchMock);
  const result = await client.list("/accounts/account_123/workers/scripts");

  assert.equal(result.ok, true);
  assert.deepEqual(result.items, ["item-1", "item-2", "item-3"]);
  assert.deepEqual(pages, [1, 2, 3]);
});

test("CloudflareApiClient returns structured failure for 403 and network errors", async () => {
  const forbiddenClient = new CloudflareApiClient(TOKEN, async () => jsonResponse({ success: false }, 403));
  const forbidden = await forbiddenClient.get("/accounts/account_123/r2/buckets");

  assert.equal(forbidden.ok, false);
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.reason, "permission");

  const networkClient = new CloudflareApiClient(TOKEN, async () => {
    throw new Error("network unavailable");
  });
  const network = await networkClient.get("/accounts/account_123/hyperdrive/configs");

  assert.equal(network.ok, false);
  assert.equal(network.status, 0);
  assert.equal(network.reason, "network");
});

test("CloudflareApiClient rejects non-absolute API paths", async () => {
  const client = new CloudflareApiClient(TOKEN, async () => jsonResponse({ success: true, result: [] }));

  await assert.rejects(() => client.get("https://api.example.test/unsafe"), /Cloudflare API path must start with/);
  await assert.rejects(() => client.get("zones/zone_123"), /Cloudflare API path must start with/);
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
