import assert from "node:assert/strict";
import test from "node:test";
import { scanCloudflare } from "../../src/connectors/cloudflare.js";

const TOKEN = "cloudflare_secret_token_value";

test("scanCloudflare emits zone metadata without returning token or DNS content values", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(url), init });
    const parsed = new URL(String(url));

    if (parsed.pathname === "/client/v4/zones") {
      return jsonResponse({ success: true, result: [{ id: "zone_123", name: "example.com", status: "active" }] });
    }
    if (parsed.pathname === "/client/v4/zones/zone_123/settings/ssl") {
      return jsonResponse({ success: true, result: { id: "ssl", value: "full" } });
    }
    if (parsed.pathname === "/client/v4/zones/zone_123/rulesets") {
      return jsonResponse({ success: true, result: [{ phase: "http_request_firewall_custom" }] });
    }
    if (parsed.pathname === "/client/v4/zones/zone_123/access/apps") {
      return jsonResponse({ success: true, result: [{ name: "Admin" }, { name: "Internal" }] });
    }
    if (parsed.pathname === "/client/v4/zones/zone_123/dns_records") {
      return jsonResponse({
        success: true,
        result: [
          { type: "A", name: "app.example.com", content: "203.0.113.10" },
          { type: "CNAME", name: "www.example.com", content: "secret-target.example.net" },
          { type: "A", name: "api.example.com", content: "203.0.113.11" }
        ]
      });
    }
    return jsonResponse({ success: false, errors: [{ message: "not found" }] }, 404);
  };

  const signals = await scanCloudflare({ zone: "example.com", token: TOKEN }, fetchMock);
  const serialized = JSON.stringify(signals);

  assert.equal(signals.find((signal) => signal.id === "cloudflare:zone")?.metadata.exists, true);
  assert.equal(signals.find((signal) => signal.id === "cloudflare:tls-mode")?.metadata.tlsMode, "full");
  assert.equal(signals.find((signal) => signal.id === "cloudflare:waf")?.metadata.available, true);
  assert.equal(signals.find((signal) => signal.id === "cloudflare:access-apps")?.metadata.appCount, 2);
  assert.deepEqual(signals.find((signal) => signal.id === "cloudflare:dns-records")?.metadata.recordTypes, ["A", "CNAME"]);
  assert.deepEqual(signals.find((signal) => signal.id === "cloudflare:dns-records")?.metadata.recordTypeCounts, ["A:2", "CNAME:1"]);
  assert.equal(signals.find((signal) => signal.id === "cloudflare:zone")?.metadata.product, "zone");
  assert.equal(signals.find((signal) => signal.id === "cloudflare:tls-mode")?.metadata.product, "zone");
  assert.equal(signals.find((signal) => signal.id === "cloudflare:waf")?.metadata.product, "waf");
  assert.equal(signals.find((signal) => signal.id === "cloudflare:access-apps")?.metadata.product, "access");
  assert.equal(signals.find((signal) => signal.id === "cloudflare:dns-records")?.metadata.product, "dns");
  assert.deepEqual(signals.find((signal) => signal.id === "cloudflare:waf")?.metadata.requirement_ids, [
    "ISMS-P-2.10.2.cloudflare-config-export"
  ]);

  assert.doesNotMatch(serialized, new RegExp(TOKEN));
  assert.doesNotMatch(serialized, /203\.0\.113\.10/);
  assert.doesNotMatch(serialized, /secret-target/);
  assert.doesNotMatch(serialized, /app\.example\.com/);
  for (const call of calls) {
    assert.equal((call.init?.headers as Record<string, string>).Authorization, `Bearer ${TOKEN}`);
    assert.doesNotMatch(call.url, new RegExp(TOKEN));
  }
});

test("scanCloudflare turns optional endpoint failures into needs_confirmation signals", async () => {
  const fetchMock = async (url: string | URL | Request): Promise<Response> => {
    const parsed = new URL(String(url));
    if (parsed.pathname === "/client/v4/zones") {
      return jsonResponse({ success: true, result: [{ id: "zone_123", name: "example.com", status: "active" }] });
    }
    if (parsed.pathname.endsWith("/settings/ssl")) {
      return jsonResponse({ success: true, result: { value: "strict" } });
    }
    if (parsed.pathname.endsWith("/dns_records")) {
      return jsonResponse({ success: true, result: [] });
    }
    return jsonResponse({ success: false, errors: [{ message: "forbidden" }] }, 403);
  };

  const signals = await scanCloudflare({ zone: "example.com", token: TOKEN }, fetchMock);

  assert.equal(signals.find((signal) => signal.id === "cloudflare:waf")?.basis, "needs_confirmation");
  assert.equal(signals.find((signal) => signal.id === "cloudflare:access-apps")?.basis, "needs_confirmation");
});

test("scanCloudflare emits public-safe account-level product inventory signals", async () => {
  const fetchMock = async (url: string | URL | Request): Promise<Response> => {
    const parsed = new URL(String(url));

    if (parsed.pathname === "/client/v4/zones") {
      return jsonResponse({ success: true, result: [{ id: "zone_123", name: "example.com", status: "active" }] });
    }
    if (parsed.pathname === "/client/v4/accounts/account_123/workers/scripts") {
      return jsonResponse({
        success: true,
        result: [
          { id: "script_internal_name", script: "secret code", modified_on: "2026-05-29T00:00:00Z" },
          { id: "script_two", usage_model: "bundled" }
        ],
        result_info: { page: 1, total_pages: 1 }
      });
    }
    if (parsed.pathname === "/client/v4/accounts/account_123/r2/buckets") {
      return jsonResponse({
        success: true,
        result: {
          buckets: [
            { name: "private-customer-uploads", location: "APAC", object_count: 32 },
            { name: "audit-exports", location: "APAC" }
          ]
        }
      });
    }
    if (parsed.pathname === "/client/v4/accounts/account_123/hyperdrive/configs") {
      return jsonResponse({
        success: true,
        result: [
          {
            id: "hyperdrive_123",
            name: "prod-dsql",
            origin: {
              host: "private-db.example.internal",
              database: "customer_prod",
              user: "db_user",
              password: "db_password"
            }
          }
        ]
      });
    }
    if (parsed.pathname === "/client/v4/zones/zone_123/api_gateway/discovery/operations") {
      return jsonResponse({
        success: true,
        result: [
          { endpoint: "/api/private/customer", host: "api.example.com", method: "POST" },
          { endpoint: "/api/admin", host: "admin.example.com", method: "GET" }
        ]
      });
    }

    return jsonResponse({ success: true, result: [] });
  };

  const signals = await scanCloudflare({
    zone: "example.com",
    accountId: "account_123",
    products: ["workers", "r2", "hyperdrive", "api-gateway"],
    token: TOKEN
  }, fetchMock);
  const serialized = JSON.stringify(signals);

  assert.equal(signals.find((signal) => signal.id === "cloudflare:workers")?.metadata.count, 2);
  assert.equal(signals.find((signal) => signal.id === "cloudflare:r2")?.metadata.count, 2);
  assert.equal(signals.find((signal) => signal.id === "cloudflare:hyperdrive")?.metadata.count, 1);
  assert.equal(signals.find((signal) => signal.id === "cloudflare:api-gateway")?.metadata.count, 2);

  assert.doesNotMatch(serialized, /cloudflare_secret_token_value/);
  assert.doesNotMatch(serialized, /script_internal_name/);
  assert.doesNotMatch(serialized, /secret code/);
  assert.doesNotMatch(serialized, /private-customer-uploads/);
  assert.doesNotMatch(serialized, /audit-exports/);
  assert.doesNotMatch(serialized, /private-db\.example\.internal/);
  assert.doesNotMatch(serialized, /customer_prod/);
  assert.doesNotMatch(serialized, /db_user/);
  assert.doesNotMatch(serialized, /db_password/);
  assert.doesNotMatch(serialized, /\/api\/private\/customer/);
  assert.doesNotMatch(serialized, /admin\.example\.com/);
});

test("scanCloudflare returns needs_confirmation for account products without account id", async () => {
  const fetchMock = async (url: string | URL | Request): Promise<Response> => {
    const parsed = new URL(String(url));
    if (parsed.pathname === "/client/v4/zones") {
      return jsonResponse({ success: true, result: [{ id: "zone_123", name: "example.com", status: "active" }] });
    }
    return jsonResponse({ success: true, result: [] });
  };

  const signals = await scanCloudflare({ zone: "example.com", products: ["workers", "r2"], token: TOKEN }, fetchMock);

  assert.equal(signals.find((signal) => signal.id === "cloudflare:workers")?.basis, "needs_confirmation");
  assert.equal(signals.find((signal) => signal.id === "cloudflare:workers")?.metadata.permission_status, "missing_account_id");
  assert.equal(signals.find((signal) => signal.id === "cloudflare:r2")?.basis, "needs_confirmation");
});

test("scanCloudflare converts account product 403 responses into needs_confirmation", async () => {
  const fetchMock = async (url: string | URL | Request): Promise<Response> => {
    const parsed = new URL(String(url));
    if (parsed.pathname === "/client/v4/zones") {
      return jsonResponse({ success: true, result: [{ id: "zone_123", name: "example.com", status: "active" }] });
    }
    if (parsed.pathname.includes("/accounts/account_123/")) {
      return jsonResponse({ success: false, errors: [{ message: "forbidden" }] }, 403);
    }
    return jsonResponse({ success: true, result: [] });
  };

  const signals = await scanCloudflare({
    zone: "example.com",
    accountId: "account_123",
    products: ["workers", "r2", "hyperdrive"],
    token: TOKEN
  }, fetchMock);

  assert.equal(signals.find((signal) => signal.id === "cloudflare:workers")?.basis, "needs_confirmation");
  assert.equal(signals.find((signal) => signal.id === "cloudflare:workers")?.metadata.permission_status, "needs_permission_or_confirmation");
  assert.equal(signals.find((signal) => signal.id === "cloudflare:r2")?.basis, "needs_confirmation");
  assert.equal(signals.find((signal) => signal.id === "cloudflare:hyperdrive")?.basis, "needs_confirmation");
});

test("scanCloudflare scans account-independent products even when zone lookup fails", async () => {
  const fetchMock = async (url: string | URL | Request): Promise<Response> => {
    const parsed = new URL(String(url));
    if (parsed.pathname === "/client/v4/zones") {
      return jsonResponse({ success: false, errors: [{ message: "forbidden" }] }, 403);
    }
    if (parsed.pathname === "/client/v4/accounts/account_123/workers/scripts") {
      return jsonResponse({ success: true, result: [{ id: "private-worker-name" }] });
    }
    if (parsed.pathname === "/client/v4/accounts/account_123/r2/buckets") {
      return jsonResponse({ success: true, result: { buckets: [{ name: "private-bucket-name" }] } });
    }
    if (parsed.pathname === "/client/v4/accounts/account_123/hyperdrive/configs") {
      return jsonResponse({ success: true, result: [{ name: "private-hyperdrive-name", origin: { host: "private-db.example.internal" } }] });
    }
    return jsonResponse({ success: false, errors: [{ message: "not found" }] }, 404);
  };

  const signals = await scanCloudflare({
    zone: "example.com",
    accountId: "account_123",
    products: ["zone", "workers", "r2", "hyperdrive", "api-gateway"],
    token: TOKEN
  }, fetchMock);
  const serialized = JSON.stringify(signals);

  assert.equal(signals.find((signal) => signal.id === "cloudflare:zone")?.basis, "needs_confirmation");
  assert.equal(signals.find((signal) => signal.id === "cloudflare:workers")?.metadata.count, 1);
  assert.equal(signals.find((signal) => signal.id === "cloudflare:r2")?.metadata.count, 1);
  assert.equal(signals.find((signal) => signal.id === "cloudflare:hyperdrive")?.metadata.count, 1);
  assert.equal(signals.find((signal) => signal.id === "cloudflare:api-gateway")?.basis, "needs_confirmation");
  assert.equal(signals.find((signal) => signal.id === "cloudflare:api-gateway")?.metadata.permission_status, "zone_unavailable");
  assert.doesNotMatch(serialized, /private-worker-name|private-bucket-name|private-hyperdrive-name|private-db/);
});

test("scanCloudflare skips zone lookup for account-independent product scans", async () => {
  const calls: string[] = [];
  const fetchMock = async (url: string | URL | Request): Promise<Response> => {
    const parsed = new URL(String(url));
    calls.push(parsed.pathname);
    if (parsed.pathname === "/client/v4/accounts/account_123/workers/scripts") {
      return jsonResponse({ success: true, result: [{ id: "private-worker-name" }] });
    }
    return jsonResponse({ success: false, errors: [{ message: "unexpected endpoint" }] }, 500);
  };

  const signals = await scanCloudflare({
    zone: "example.com",
    accountId: "account_123",
    products: ["workers"],
    token: TOKEN
  }, fetchMock);

  assert.equal(signals.find((signal) => signal.id === "cloudflare:workers")?.metadata.count, 1);
  assert.deepEqual(calls, ["/client/v4/accounts/account_123/workers/scripts"]);
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
