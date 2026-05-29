import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCloudflareProducts, parseCloudflareProducts } from "../../src/connectors/cloudflare-products.js";

test("parseCloudflareProducts accepts comma-separated product names", () => {
  assert.deepEqual(parseCloudflareProducts("zone,waf,dns,workers,r2,hyperdrive,api-gateway"), [
    "zone",
    "waf",
    "dns",
    "workers",
    "r2",
    "hyperdrive",
    "api-gateway"
  ]);
});

test("parseCloudflareProducts rejects unknown products and empty entries", () => {
  assert.equal(parseCloudflareProducts("zone,,r2"), undefined);
  assert.equal(parseCloudflareProducts("zone,secrets"), undefined);
});

test("normalizeCloudflareProducts keeps legacy zone scan behavior by default", () => {
  assert.deepEqual(normalizeCloudflareProducts(undefined), ["zone", "waf", "access", "dns"]);
});

test("normalizeCloudflareProducts removes duplicates while preserving order", () => {
  assert.deepEqual(normalizeCloudflareProducts(["workers", "r2", "workers", "zone"]), ["workers", "r2", "zone"]);
});
