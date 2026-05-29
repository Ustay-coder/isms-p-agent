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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
