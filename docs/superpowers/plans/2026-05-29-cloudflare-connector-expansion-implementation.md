# Cloudflare Connector Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the Cloudflare connector from zone-only metadata into an opt-in account-level inventory scanner for Workers, R2, Hyperdrive, API Gateway, Access, WAF, DNS, and zone posture while preserving public-safe scan outputs.

**Architecture:** Keep `scanCloudflare()` as the public connector entrypoint, but split API transport, safety helpers, zone scanners, and account product scanners into small modules. Every product scanner emits allowlisted `ScanSignal` metadata only; private or raw Cloudflare API payloads never enter scan files, reports, or public exports.

**Tech Stack:** TypeScript, Node.js 22 built-in test runner, native `fetch`, existing `ScanSignal` schema, existing `isms-agent scan/evidence/report` workflow.

---

## Scope

This plan implements Phase 1 from `docs/superpowers/specs/2026-05-29-cloudflare-connector-expansion-design.md`.

Included:
- Keep current `isms-agent scan --cloudflare example.com` and `isms-agent scan --cloudflare zone_123` behavior compatible.
- Add `--cloudflare-account account_123` style account ID input.
- Add `--cloudflare-products zone,access,waf,dns,workers,r2,hyperdrive,api-gateway`.
- Add account-level product signals for Workers, R2, Hyperdrive, and API Gateway using count/presence/status metadata only.
- Convert missing account IDs, permission failures, unsupported endpoints, and network failures into `needs_confirmation` signals.
- Add tests proving token values, raw API bodies, DNS content values, R2 object keys, database connection fields, Worker secret values, route hostnames, and user identities are omitted.

Excluded from this PR:
- Mutating Cloudflare settings.
- Fetching logs, request payloads, R2 object lists, Worker secret values, or user/admin identities.
- Accepting evidence automatically.
- Making public reports include real account IDs, bucket names, route patterns, Hyperdrive names, DNS content values, or API response bodies.

## File Structure

- Modify `src/schemas/scan.ts`
  - Add `"string[]"` compatibility only if product metadata needs string arrays already supported by the current type. No schema version bump is planned because `ScanSignal.metadata` already supports the required primitive values and string arrays.

- Create `src/connectors/cloudflare-api.ts`
  - GET-only Cloudflare API helper.
  - Centralizes base URL, Authorization header, JSON parsing, network failure handling, and pagination.
  - Never accepts token values in URL search params.

- Create `src/connectors/cloudflare-safety.ts`
  - Allowlist helpers for connector metadata.
  - Shared `cloudflareObserved()` and `cloudflareNeedsConfirmation()` signal builders.
  - Shared unsafe-string guard for tests.

- Create `src/connectors/cloudflare-products.ts`
  - Product normalization and product group helpers.
  - Valid product IDs: `zone`, `access`, `waf`, `dns`, `workers`, `r2`, `hyperdrive`, `api-gateway`.

- Modify `src/connectors/cloudflare.ts`
  - Keep `scanCloudflare(input, fetchImpl)` as the public API.
  - Extend `CloudflareInput` with `accountId?: string` and `products?: CloudflareProduct[]`.
  - Delegate zone-compatible products to current zone scanners.
  - Delegate account products to isolated product scanner functions.

- Modify `src/commands/scan.ts`
  - Extend `ScanOptions` with `cloudflareAccount?: string` and `cloudflareProducts?: CloudflareProduct[]`.
  - Pass the new options into `scanCloudflare()`.

- Modify `src/cli.ts`
  - Parse `--cloudflare-account`.
  - Parse `--cloudflare-products` as comma-separated values.
  - Update scan usage text.

- Modify `test/connectors/cloudflare.test.ts`
  - Preserve current zone behavior tests.
  - Add account-level fixture responses.
  - Add safety assertions for omitted sensitive values.

- Create `test/connectors/cloudflare-api.test.ts`
  - Test GET-only behavior, auth header placement, token omission from URLs, pagination, 403 handling, and network handling.

- Create `test/connectors/cloudflare-products.test.ts`
  - Test product parsing/normalization without invoking the CLI top-level module.

- Modify `README.md`
  - Document the expanded command shape and the candidate-evidence workflow.

- Modify `docs/security-model.md`
  - Document Cloudflare token scope expectations and retained/omitted data.

---

### Task 0: Documentation Gate

**Files:**
- Read: `docs/superpowers/specs/2026-05-29-cloudflare-connector-expansion-design.md`
- Read: `src/connectors/cloudflare.ts`
- Read: `test/connectors/cloudflare.test.ts`

- [ ] **Step 1: Re-run Context7 for Cloudflare API docs before implementing endpoints**

Run:

```bash
npx ctx7@latest library Cloudflare "Cloudflare API endpoints and token scopes for listing Workers scripts, R2 buckets, Hyperdrive configs, API Shield/API Gateway discovery or schema validation, Access applications, WAF rulesets, DNS records, and zone SSL settings"
```

Expected:
- If Context7 returns a `/org/project` library ID, continue to Step 2.
- If Context7 returns quota error, authenticate before coding endpoint paths:

```bash
npx ctx7@latest login
```

- [ ] **Step 2: Fetch Cloudflare docs from the resolved library ID**

Run with the selected Cloudflare library ID:

```bash
npx ctx7@latest docs /cloudflare/cloudflare "Cloudflare API endpoints and token scopes for listing Workers scripts, R2 buckets, Hyperdrive configs, API Shield/API Gateway discovery or schema validation, Access applications, WAF rulesets, DNS records, and zone SSL settings"
```

Expected:
- Confirm exact GET endpoints and required token scopes for:
  - zone lookup,
  - zone SSL settings,
  - zone rulesets/WAF,
  - zone DNS records,
  - Access applications,
  - Workers scripts and routes,
  - R2 buckets,
  - Hyperdrive configs,
  - API Gateway/API Shield discovery or schema-validation metadata.
- Record confirmed endpoint paths in the implementation PR description.
- If Cloudflare docs show a planned endpoint is unavailable or requires unsafe raw payload collection, implement a `needs_confirmation` signal for that product instead of collecting unsupported data.

- [ ] **Step 3: Verify current baseline before changing code**

Run:

```bash
npm test
```

Expected:
- PASS with the current test suite.

---

### Task 1: Add GET-Only Cloudflare API Client

**Files:**
- Create: `src/connectors/cloudflare-api.ts`
- Create: `test/connectors/cloudflare-api.test.ts`

- [ ] **Step 1: Write failing API client tests**

Create `test/connectors/cloudflare-api.test.ts`:

```ts
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
```

- [ ] **Step 2: Run API client tests and verify they fail**

Run:

```bash
npm run build
node --test dist/test/connectors/cloudflare-api.test.js
```

Expected:
- FAIL because `src/connectors/cloudflare-api.ts` does not exist.

- [ ] **Step 3: Implement API client**

Create `src/connectors/cloudflare-api.ts`:

```ts
const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";
const MAX_PAGES = 25;

export type CloudflareApiFailureReason = "permission" | "network" | "api_error";

export type CloudflareApiResult =
  | { ok: true; status: number; body: unknown; endpoint: string }
  | { ok: false; status: number; body: unknown; endpoint: string; reason: CloudflareApiFailureReason };

export type CloudflareListResult =
  | { ok: true; status: number; items: unknown[]; endpoint: string }
  | { ok: false; status: number; items: unknown[]; endpoint: string; reason: CloudflareApiFailureReason };

export class CloudflareApiClient {
  constructor(private readonly token: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async get(path: string, search: Record<string, string | number | boolean> = {}): Promise<CloudflareApiResult> {
    const endpoint = buildEndpoint(path, search);
    try {
      const response = await this.fetchImpl(endpoint, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.token}`
        }
      });
      const body = await readJson(response);
      if (response.ok) {
        return { ok: true, status: response.status, body, endpoint: endpoint.pathname };
      }
      return {
        ok: false,
        status: response.status,
        body,
        endpoint: endpoint.pathname,
        reason: response.status === 401 || response.status === 403 ? "permission" : "api_error"
      };
    } catch {
      return { ok: false, status: 0, body: undefined, endpoint: endpoint.pathname, reason: "network" };
    }
  }

  async list(path: string, search: Record<string, string | number | boolean> = {}): Promise<CloudflareListResult> {
    const items: unknown[] = [];
    let status = 200;
    let endpoint = path;

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const result = await this.get(path, { ...search, page });
      endpoint = result.endpoint;
      status = result.status;
      if (!result.ok) {
        return { ok: false, status, items, endpoint, reason: result.reason };
      }

      const body = asRecord(result.body);
      items.push(...arrayValue(body.result));
      const totalPages = numberValue(asRecord(body.result_info).total_pages) ?? 1;
      if (page >= totalPages) {
        return { ok: true, status, items, endpoint };
      }
    }

    return { ok: true, status, items, endpoint };
  }
}

function buildEndpoint(path: string, search: Record<string, string | number | boolean>): URL {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("://")) {
    throw new Error(`Cloudflare API path must start with a single slash: ${path}`);
  }

  const endpoint = new URL(path, CLOUDFLARE_API_BASE);
  for (const [key, value] of Object.entries(search)) {
    endpoint.searchParams.set(key, String(value));
  }
  return endpoint;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
```

- [ ] **Step 4: Verify API client tests pass**

Run:

```bash
npm run build
node --test dist/test/connectors/cloudflare-api.test.js
```

Expected:
- PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/connectors/cloudflare-api.ts test/connectors/cloudflare-api.test.ts
git commit -m "feat: add cloudflare get-only api client"
```

---

### Task 2: Add Product Normalization and Signal Safety Helpers

**Files:**
- Create: `src/connectors/cloudflare-products.ts`
- Create: `src/connectors/cloudflare-safety.ts`
- Create: `test/connectors/cloudflare-products.test.ts`

- [ ] **Step 1: Write failing product normalization tests**

Create `test/connectors/cloudflare-products.test.ts`:

```ts
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
```

- [ ] **Step 2: Run product tests and verify they fail**

Run:

```bash
npm run build
node --test dist/test/connectors/cloudflare-products.test.js
```

Expected:
- FAIL because `src/connectors/cloudflare-products.ts` does not exist.

- [ ] **Step 3: Implement product helpers**

Create `src/connectors/cloudflare-products.ts`:

```ts
export const CLOUDFLARE_PRODUCTS = ["zone", "access", "waf", "dns", "workers", "r2", "hyperdrive", "api-gateway"] as const;
export type CloudflareProduct = typeof CLOUDFLARE_PRODUCTS[number];

export const DEFAULT_CLOUDFLARE_PRODUCTS: CloudflareProduct[] = ["zone", "waf", "access", "dns"];
export const ACCOUNT_CLOUDFLARE_PRODUCTS: CloudflareProduct[] = ["workers", "r2", "hyperdrive", "api-gateway"];

export function parseCloudflareProducts(value: string): CloudflareProduct[] | undefined {
  const parts = value.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length === 0 || parts.length !== value.split(",").length) {
    return undefined;
  }

  const products: CloudflareProduct[] = [];
  for (const part of parts) {
    if (!isCloudflareProduct(part)) {
      return undefined;
    }
    products.push(part);
  }
  return products;
}

export function normalizeCloudflareProducts(products: CloudflareProduct[] | undefined): CloudflareProduct[] {
  const selected = products && products.length > 0 ? products : DEFAULT_CLOUDFLARE_PRODUCTS;
  const normalized: CloudflareProduct[] = [];
  for (const product of selected) {
    if (!normalized.includes(product)) {
      normalized.push(product);
    }
  }
  return normalized;
}

export function isAccountCloudflareProduct(product: CloudflareProduct): boolean {
  return ACCOUNT_CLOUDFLARE_PRODUCTS.includes(product);
}

function isCloudflareProduct(value: string): value is CloudflareProduct {
  return (CLOUDFLARE_PRODUCTS as readonly string[]).includes(value);
}
```

- [ ] **Step 4: Implement signal safety helpers**

Create `src/connectors/cloudflare-safety.ts`:

```ts
import type { ScanSignal } from "../schemas/scan.js";

export const CLOUDFLARE_REQUIREMENTS = {
  configExport: "ISMS-P-2.10.2.cloudflare-config-export",
  adminAccessReview: "ISMS-P-2.10.2.cloud-admin-access-review",
  changeApproval: "ISMS-P-2.10.2.cloud-change-approval"
} as const;

export type SafeCloudflareMetadataValue = string | number | boolean | string[];
export type SafeCloudflareMetadata = Record<string, SafeCloudflareMetadataValue>;

export function cloudflareObserved(id: string, summary: string, metadata: SafeCloudflareMetadata): ScanSignal {
  return { id, source: "cloudflare", basis: "observed", summary, paths: [], metadata: withDefaults(id, metadata) };
}

export function cloudflareNeedsConfirmation(id: string, summary: string, metadata: SafeCloudflareMetadata): ScanSignal {
  return { id, source: "cloudflare", basis: "needs_confirmation", summary, paths: [], metadata: withDefaults(id, metadata) };
}

export function permissionMetadata(product: string, endpoint: string, requirementIds: string[]): SafeCloudflareMetadata {
  return {
    product,
    endpoint,
    permission_status: "needs_permission_or_confirmation",
    requirement_ids: requirementIds,
    sensitivity: "internal"
  };
}

function withDefaults(id: string, metadata: SafeCloudflareMetadata): SafeCloudflareMetadata {
  return {
    snapshot_id: id,
    sensitivity: "internal",
    ...metadata
  };
}
```

- [ ] **Step 5: Verify product tests pass**

Run:

```bash
npm run build
node --test dist/test/connectors/cloudflare-products.test.js
```

Expected:
- PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/connectors/cloudflare-products.ts src/connectors/cloudflare-safety.ts test/connectors/cloudflare-products.test.ts
git commit -m "feat: add cloudflare product safety helpers"
```

---

### Task 3: Refactor Existing Zone Scan Onto the New Helpers

**Files:**
- Modify: `src/connectors/cloudflare.ts`
- Modify: `test/connectors/cloudflare.test.ts`

- [ ] **Step 1: Strengthen current zone safety test before refactor**

In `test/connectors/cloudflare.test.ts`, add these assertions to the existing zone metadata test:

```ts
assert.equal(signals.find((signal) => signal.id === "cloudflare:zone")?.metadata.product, "zone");
assert.equal(signals.find((signal) => signal.id === "cloudflare:tls-mode")?.metadata.product, "zone");
assert.equal(signals.find((signal) => signal.id === "cloudflare:waf")?.metadata.product, "waf");
assert.equal(signals.find((signal) => signal.id === "cloudflare:access-apps")?.metadata.product, "access");
assert.equal(signals.find((signal) => signal.id === "cloudflare:dns-records")?.metadata.product, "dns");
assert.deepEqual(signals.find((signal) => signal.id === "cloudflare:waf")?.metadata.requirement_ids, [
  "ISMS-P-2.10.2.cloudflare-config-export"
]);
```

- [ ] **Step 2: Run the Cloudflare connector test and verify it fails**

Run:

```bash
npm run build
node --test dist/test/connectors/cloudflare.test.js
```

Expected:
- FAIL because current metadata does not include product and requirement mappings.

- [ ] **Step 3: Refactor `scanCloudflare()` to use the API client and helpers**

Modify `src/connectors/cloudflare.ts` so the exported input shape becomes:

```ts
import { CloudflareApiClient, type CloudflareApiResult } from "./cloudflare-api.js";
import { normalizeCloudflareProducts, type CloudflareProduct } from "./cloudflare-products.js";
import { CLOUDFLARE_REQUIREMENTS, cloudflareNeedsConfirmation, cloudflareObserved, permissionMetadata } from "./cloudflare-safety.js";
import type { ScanSignal } from "../schemas/scan.js";

export interface CloudflareInput {
  zone: string;
  token?: string;
  accountId?: string;
  products?: CloudflareProduct[];
}
```

Update token-missing handling:

```ts
if (!input.token) {
  return [
    cloudflareNeedsConfirmation("cloudflare:token", "CLOUDFLARE_API_TOKEN is required to scan Cloudflare metadata.", {
      product: "cloudflare",
      endpoint: "auth",
      permission_status: "missing_token",
      requirement_ids: [CLOUDFLARE_REQUIREMENTS.configExport],
      available: false
    })
  ];
}
```

Use `const client = new CloudflareApiClient(input.token, fetchImpl);` and replace existing `getJson()` calls with `client.get()` or `client.list()`.

For zone metadata, emit:

```ts
cloudflareObserved("cloudflare:zone", "Cloudflare zone metadata is available.", {
  product: "zone",
  endpoint: "/zones",
  permission_status: "available",
  requirement_ids: [CLOUDFLARE_REQUIREMENTS.configExport],
  available: true,
  status: zoneResult.status ?? "unknown"
});
```

For TLS mode, emit:

```ts
cloudflareObserved("cloudflare:tls-mode", `Cloudflare TLS/SSL mode is ${tlsMode}.`, {
  product: "zone",
  endpoint: "/zones/{zone_id}/settings/ssl",
  permission_status: "available",
  requirement_ids: [CLOUDFLARE_REQUIREMENTS.configExport],
  available: true,
  tlsMode
});
```

For WAF/rulesets, emit:

```ts
cloudflareObserved("cloudflare:waf", available ? "Cloudflare WAF/ruleset metadata is available." : "Cloudflare WAF/ruleset metadata was not observed.", {
  product: "waf",
  endpoint: "/zones/{zone_id}/rulesets",
  permission_status: "available",
  requirement_ids: [CLOUDFLARE_REQUIREMENTS.configExport],
  available,
  count: result.length
});
```

For Access apps, emit:

```ts
cloudflareObserved("cloudflare:access-apps", `Cloudflare Access metadata shows ${count} application(s).`, {
  product: "access",
  endpoint: "/zones/{zone_id}/access/apps",
  permission_status: "available",
  requirement_ids: [CLOUDFLARE_REQUIREMENTS.adminAccessReview],
  available: count > 0,
  count
});
```

For DNS records, keep only counts and types:

```ts
cloudflareObserved("cloudflare:dns-records", `Cloudflare DNS metadata shows ${records.length} record(s).`, {
  product: "dns",
  endpoint: "/zones/{zone_id}/dns_records",
  permission_status: "available",
  requirement_ids: [CLOUDFLARE_REQUIREMENTS.configExport],
  available: records.length > 0,
  count: records.length,
  recordTypes,
  recordTypeCounts: recordTypes.map((type) => `${type}:${counts.get(type) ?? 0}`)
});
```

For failures, emit:

```ts
cloudflareNeedsConfirmation(id, `Cloudflare API returned ${statusText} while checking ${label}.`, {
  ...permissionMetadata(product, endpoint, requirementIds),
  available: false
});
```

- [ ] **Step 4: Verify current Cloudflare behavior still passes**

Run:

```bash
npm run build
node --test dist/test/connectors/cloudflare.test.js
```

Expected:
- PASS.
- Existing signal IDs remain unchanged:
  - `cloudflare:zone`
  - `cloudflare:tls-mode`
  - `cloudflare:waf`
  - `cloudflare:access-apps`
  - `cloudflare:dns-records`

- [ ] **Step 5: Commit**

Run:

```bash
git add src/connectors/cloudflare.ts test/connectors/cloudflare.test.ts
git commit -m "refactor: keep cloudflare zone scan public safe"
```

---

### Task 4: Wire CLI and Scan Options

**Files:**
- Modify: `src/commands/scan.ts`
- Modify: `src/cli.ts`
- Modify: `test/connectors/cloudflare-products.test.ts`

- [ ] **Step 1: Add a parsing test for comma-separated products**

Extend `test/connectors/cloudflare-products.test.ts` with:

```ts
test("parseCloudflareProducts returns undefined for uppercase or whitespace-only values", () => {
  assert.equal(parseCloudflareProducts("Workers"), undefined);
  assert.equal(parseCloudflareProducts("   "), undefined);
});
```

- [ ] **Step 2: Run product tests and verify they fail for whitespace-only input**

Run:

```bash
npm run build
node --test dist/test/connectors/cloudflare-products.test.js
```

Expected:
- FAIL if whitespace-only parsing is not yet rejected.

- [ ] **Step 3: Extend scan option types**

Modify `src/commands/scan.ts`:

```ts
import { scanCloudflare } from "../connectors/cloudflare.js";
import type { CloudflareProduct } from "../connectors/cloudflare-products.js";
```

Change `ScanOptions`:

```ts
export interface ScanOptions {
  local?: boolean;
  target?: string;
  include?: string[];
  exclude?: string[];
  github?: string;
  vercel?: string;
  cloudflare?: string;
  cloudflareAccount?: string;
  cloudflareProducts?: CloudflareProduct[];
}
```

Change the Cloudflare call:

```ts
if (options.cloudflare) {
  signals.push(...await scanCloudflare({
    zone: options.cloudflare,
    accountId: options.cloudflareAccount,
    products: options.cloudflareProducts,
    token: process.env.CLOUDFLARE_API_TOKEN
  }));
}
```

- [ ] **Step 4: Extend CLI parsing**

Modify `src/cli.ts` imports:

```ts
import { parseCloudflareProducts } from "./connectors/cloudflare-products.js";
```

In `parseScanOptions()`, add handling:

```ts
if (arg === "--cloudflare-account") {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    return undefined;
  }
  options.cloudflareAccount = value;
  index += 1;
  continue;
}

if (arg === "--cloudflare-products") {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    return undefined;
  }
  const products = parseCloudflareProducts(value);
  if (!products) {
    return undefined;
  }
  options.cloudflareProducts = products;
  index += 1;
  continue;
}
```

After the existing local-target guard, add:

```ts
if ((options.cloudflareAccount || options.cloudflareProducts) && !options.cloudflare) {
  return undefined;
}
```

Update usage text:

```ts
console.error("Usage: isms-agent scan --local [--target path] [--include paths] [--exclude paths] [--github owner/repo] [--vercel project] [--cloudflare zone-or-zone-id] [--cloudflare-account account-id] [--cloudflare-products zone,access,waf,dns,workers,r2,hyperdrive,api-gateway]");
```

- [ ] **Step 5: Verify CLI parsing through build and tests**

Run:

```bash
npm test
```

Expected:
- PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/commands/scan.ts src/cli.ts test/connectors/cloudflare-products.test.ts
git commit -m "feat: add cloudflare scan product options"
```

---

### Task 5: Add Account-Level Product Scanners

**Files:**
- Modify: `src/connectors/cloudflare.ts`
- Modify: `test/connectors/cloudflare.test.ts`

- [ ] **Step 1: Write failing account product fixture test**

Add to `test/connectors/cloudflare.test.ts`:

```ts
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
```

- [ ] **Step 2: Add missing-account and 403 tests**

Add to `test/connectors/cloudflare.test.ts`:

```ts
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
```

- [ ] **Step 3: Run connector tests and verify they fail**

Run:

```bash
npm run build
node --test dist/test/connectors/cloudflare.test.js
```

Expected:
- FAIL because account product scanning is not implemented.

- [ ] **Step 4: Implement account product scanning**

In `src/connectors/cloudflare.ts`, add product dispatch after zone lookup:

```ts
const products = normalizeCloudflareProducts(input.products);
const accountProducts = products.filter(isAccountCloudflareProduct);
for (const product of accountProducts) {
  signals.push(...await scanAccountProduct(client, product, input.accountId, zoneResult.zoneId));
}
```

Add account product scanner:

```ts
async function scanAccountProduct(
  client: CloudflareApiClient,
  product: CloudflareProduct,
  accountId: string | undefined,
  zoneId: string
): Promise<ScanSignal[]> {
  if (!accountId) {
    return [cloudflareNeedsConfirmation(`cloudflare:${product}`, `Cloudflare ${product} scan requires --cloudflare-account.`, {
      product,
      endpoint: "account",
      permission_status: "missing_account_id",
      requirement_ids: requirementIdsForProduct(product),
      available: false
    })];
  }

  if (product === "workers") {
    return [await scanWorkers(client, accountId)];
  }
  if (product === "r2") {
    return [await scanR2(client, accountId)];
  }
  if (product === "hyperdrive") {
    return [await scanHyperdrive(client, accountId)];
  }
  if (product === "api-gateway") {
    return [await scanApiGateway(client, zoneId)];
  }
  return [];
}
```

Add scanners that emit counts only:

```ts
async function scanWorkers(client: CloudflareApiClient, accountId: string): Promise<ScanSignal> {
  const endpoint = `/accounts/${encodeURIComponent(accountId)}/workers/scripts`;
  const result = await client.list(endpoint);
  if (!result.ok) {
    return accountProductFailure("workers", "/accounts/{account_id}/workers/scripts", result.status);
  }
  return cloudflareObserved("cloudflare:workers", `Cloudflare Workers metadata shows ${result.items.length} script(s).`, {
    product: "workers",
    endpoint: "/accounts/{account_id}/workers/scripts",
    permission_status: "available",
    requirement_ids: requirementIdsForProduct("workers"),
    available: result.items.length > 0,
    count: result.items.length
  });
}

async function scanR2(client: CloudflareApiClient, accountId: string): Promise<ScanSignal> {
  const result = await client.get(`/accounts/${encodeURIComponent(accountId)}/r2/buckets`);
  if (!result.ok) {
    return accountProductFailure("r2", "/accounts/{account_id}/r2/buckets", result.status);
  }
  const bucketCount = countR2Buckets(result.body);
  return cloudflareObserved("cloudflare:r2", `Cloudflare R2 metadata shows ${bucketCount} bucket(s).`, {
    product: "r2",
    endpoint: "/accounts/{account_id}/r2/buckets",
    permission_status: "available",
    requirement_ids: requirementIdsForProduct("r2"),
    available: bucketCount > 0,
    count: bucketCount
  });
}

async function scanHyperdrive(client: CloudflareApiClient, accountId: string): Promise<ScanSignal> {
  const result = await client.list(`/accounts/${encodeURIComponent(accountId)}/hyperdrive/configs`);
  if (!result.ok) {
    return accountProductFailure("hyperdrive", "/accounts/{account_id}/hyperdrive/configs", result.status);
  }
  return cloudflareObserved("cloudflare:hyperdrive", `Cloudflare Hyperdrive metadata shows ${result.items.length} config(s).`, {
    product: "hyperdrive",
    endpoint: "/accounts/{account_id}/hyperdrive/configs",
    permission_status: "available",
    requirement_ids: requirementIdsForProduct("hyperdrive"),
    available: result.items.length > 0,
    count: result.items.length
  });
}

async function scanApiGateway(client: CloudflareApiClient, zoneId: string): Promise<ScanSignal> {
  const result = await client.list(`/zones/${encodeURIComponent(zoneId)}/api_gateway/discovery/operations`);
  if (!result.ok) {
    return accountProductFailure("api-gateway", "/zones/{zone_id}/api_gateway/discovery/operations", result.status);
  }
  return cloudflareObserved("cloudflare:api-gateway", `Cloudflare API Gateway metadata shows ${result.items.length} discovered operation(s).`, {
    product: "api-gateway",
    endpoint: "/zones/{zone_id}/api_gateway/discovery/operations",
    permission_status: "available",
    requirement_ids: requirementIdsForProduct("api-gateway"),
    available: result.items.length > 0,
    count: result.items.length
  });
}
```

Add helpers:

```ts
function accountProductFailure(product: CloudflareProduct, endpoint: string, status: number): ScanSignal {
  const statusText = status === 0 ? "network error" : `${status}`;
  return cloudflareNeedsConfirmation(`cloudflare:${product}`, `Cloudflare API returned ${statusText} while checking ${product} metadata.`, {
    ...permissionMetadata(product, endpoint, requirementIdsForProduct(product)),
    available: false
  });
}

function requirementIdsForProduct(product: CloudflareProduct): string[] {
  if (product === "access") {
    return [CLOUDFLARE_REQUIREMENTS.adminAccessReview];
  }
  if (product === "workers" || product === "r2" || product === "hyperdrive" || product === "api-gateway") {
    return [CLOUDFLARE_REQUIREMENTS.configExport, CLOUDFLARE_REQUIREMENTS.changeApproval];
  }
  return [CLOUDFLARE_REQUIREMENTS.configExport];
}

function countR2Buckets(body: unknown): number {
  const result = asRecord(asRecord(body).result);
  const buckets = arrayValue(result.buckets);
  if (buckets.length > 0) {
    return buckets.length;
  }
  return arrayValue(asRecord(body).result).length;
}
```

- [ ] **Step 5: Verify connector tests pass**

Run:

```bash
npm run build
node --test dist/test/connectors/cloudflare.test.js
```

Expected:
- PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/connectors/cloudflare.ts test/connectors/cloudflare.test.ts
git commit -m "feat: scan cloudflare account inventory safely"
```

---

### Task 6: Preserve Evidence and Report Safety

**Files:**
- Modify: `test/commands/evidence.test.ts`
- Modify: `test/reports/report.test.ts`

- [ ] **Step 1: Add evidence indexing safety coverage for Cloudflare metadata**

In `test/commands/evidence.test.ts`, add a scan fixture signal:

```ts
{
  id: "cloudflare:hyperdrive",
  source: "cloudflare",
  basis: "observed",
  summary: "Cloudflare Hyperdrive metadata shows 1 config(s).",
  paths: [],
  metadata: {
    product: "hyperdrive",
    endpoint: "/accounts/{account_id}/hyperdrive/configs",
    permission_status: "available",
    requirement_ids: ["ISMS-P-2.10.2.cloudflare-config-export"],
    available: true,
    count: 1,
    sensitivity: "internal"
  }
}
```

Assert that indexed evidence:

```ts
assert.equal(indexed.metadata.product, "hyperdrive");
assert.equal(indexed.metadata.count, 1);
assert.equal(indexed.classification, "internal");
assert.doesNotMatch(JSON.stringify(indexed), /private-db|password|bucket|route|account_123/);
```

- [ ] **Step 2: Add public report redaction coverage for Cloudflare account signals**

In `test/reports/report.test.ts`, add internal Cloudflare evidence and assert public outputs omit private shape:

```ts
assert.doesNotMatch(publicReport, /account_123/);
assert.doesNotMatch(publicReport, /private-db/);
assert.doesNotMatch(publicReport, /private-customer-uploads/);
assert.match(publicReport, /cloudflare:hyperdrive|ev_scan_cloudflare/);
```

- [ ] **Step 3: Run evidence and report tests**

Run:

```bash
npm run build
node --test dist/test/commands/evidence.test.js dist/test/reports/report.test.js
```

Expected:
- PASS if current evidence/report public guards already protect connector metadata.
- FAIL if connector metadata introduces a new public leak.

- [ ] **Step 4: Fix any public leak in evidence/report code**

If Step 3 fails because public output includes private Cloudflare identifiers, update the public serializer in `src/commands/evidence.ts` and public report rendering in `src/commands/report.ts` so public mode only emits:

```ts
{
  evidence_id,
  control_id,
  requirement_ids,
  lifecycle_status,
  classification,
  public_summary
}
```

Expected public summary format:

```text
Cloudflare connector candidate signal available for review.
```

Do not include connector endpoint paths, account IDs, zone names, bucket names, route patterns, Hyperdrive config names, DNS values, reviewer rationale, or raw metadata in public output.

- [ ] **Step 5: Verify evidence/report tests pass**

Run:

```bash
npm run build
node --test dist/test/commands/evidence.test.js dist/test/reports/report.test.js
```

Expected:
- PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add test/commands/evidence.test.ts test/reports/report.test.ts src/commands/evidence.ts src/commands/report.ts
git commit -m "test: guard cloudflare evidence public output"
```

---

### Task 7: Update Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/security-model.md`

- [ ] **Step 1: Update README command examples**

Add this example to README near the scan workflow:

````md
Cloudflare zone-only scan:

```bash
CLOUDFLARE_API_TOKEN=... isms-agent scan --cloudflare example.com
```

Cloudflare account product scan:

```bash
CLOUDFLARE_API_TOKEN=... isms-agent scan \
  --cloudflare example.com \
  --cloudflare-account account_123 \
  --cloudflare-products zone,access,waf,dns,workers,r2,hyperdrive,api-gateway
```

Cloudflare connector output is candidate metadata, not accepted audit evidence. Run:

```bash
isms-agent evidence index
isms-agent evidence review ev_scan_cloudflare_hyperdrive --requirement ISMS-P-2.10.2.cloudflare-config-export --decision needs_followup --rationale "Cloud owner must confirm the exported configuration snapshot."
isms-agent report --public
isms-agent evidence validate --public
```
````

- [ ] **Step 2: Update security model retained/omitted data**

Add to `docs/security-model.md` under `Read-Only Connector Policy`:

```md
Cloudflare account scans may record product availability, counts, endpoint categories, permission status, and requirement IDs. They must not store account IDs, token values, Worker script names or code, Worker secret values, R2 bucket names or object keys, Hyperdrive database hosts, database names, database users, passwords, DNS content values, route hostnames, API operation paths, logs, request payloads, or user/admin identities.
```

Add under `No Secret Storage`:

```md
Cloudflare API tokens must be supplied through `CLOUDFLARE_API_TOKEN`. The token is used only in the `Authorization` header and must never be written to scan JSON, evidence JSONL, reports, provenance logs, command output, or public exports.
```

- [ ] **Step 3: Verify docs mention candidate-only behavior**

Run:

```bash
rg -n "Cloudflare|candidate|CLOUDFLARE_API_TOKEN|cloudflare-products" README.md docs/security-model.md
```

Expected:
- README contains `--cloudflare-products`.
- README says Cloudflare output is candidate metadata.
- Security model says tokens are supplied through `CLOUDFLARE_API_TOKEN`.
- Security model lists retained and omitted Cloudflare data.

- [ ] **Step 4: Commit**

Run:

```bash
git add README.md docs/security-model.md
git commit -m "docs: describe cloudflare connector expansion"
```

---

### Task 8: Final Verification

**Files:**
- Verify entire repository.

- [ ] **Step 1: Run full test suite**

Run:

```bash
npm test
```

Expected:
- PASS.

- [ ] **Step 2: Run type check**

Run:

```bash
npm run check
```

Expected:
- PASS.

- [ ] **Step 3: Run pack validator**

Run:

```bash
node dist/cli.js pack validate
```

Expected:

```json
{
  "valid": true
}
```

The output may include additional fields such as checked control count. It must not include validation issues.

- [ ] **Step 4: Run public evidence validator**

Run:

```bash
node dist/cli.js evidence validate --public
```

Expected:

```json
{
  "valid": true
}
```

Warnings are acceptable only for unmapped candidate evidence. Any warning that mentions token values, bucket names, database hosts, DNS values, account IDs, route hostnames, API paths, logs, request payloads, or user identities is a release blocker.

- [ ] **Step 5: Run whitespace check**

Run:

```bash
git diff --check
```

Expected:
- No output.

- [ ] **Step 6: Manual local E2E with mocked-safe expectations**

Run against a workspace that has a scan fixture or a real token with least-privilege read permissions:

```bash
CLOUDFLARE_API_TOKEN=... node dist/cli.js scan \
  --cloudflare example.com \
  --cloudflare-account account_123 \
  --cloudflare-products zone,access,waf,dns,workers,r2,hyperdrive,api-gateway
node dist/cli.js evidence index
node dist/cli.js report --public
node dist/cli.js evidence validate --public
```

Expected:
- Scan file exists under `scans/`.
- Public report exists under `reports/public-control-gap-report.md`.
- `evidence validate --public` returns `valid: true`.
- Public files do not contain token values, account IDs, bucket names, database hosts, DNS values, route hostnames, API operation paths, logs, request payloads, or user/admin identities.

---

## Self-Review

- Spec coverage:
  - `CloudflareInput.accountId` and `products`: Task 3 and Task 4.
  - CLI flags: Task 4.
  - GET-only client, pagination, 403 handling: Task 1.
  - Product scanners: Task 5.
  - Requirement IDs: Task 2, Task 3, Task 5.
  - Unsafe-field omission tests: Task 1, Task 5, Task 6.
  - README and security model: Task 7.
  - Required verification commands: Task 8.

- Safety coverage:
  - Missing token returns `needs_confirmation`.
  - Missing account ID returns `needs_confirmation`.
  - 403 returns `needs_confirmation`.
  - Network failure returns `needs_confirmation`.
  - Raw API payloads are counted and dropped.
  - Public export/report remains evidence-ID and safe-summary oriented.

- Type consistency:
  - `CloudflareProduct` is defined in `src/connectors/cloudflare-products.ts`.
  - `CloudflareInput.products` uses `CloudflareProduct[]`.
  - `ScanOptions.cloudflareProducts` uses `CloudflareProduct[]`.
  - `ScanSignal.metadata` remains compatible with the existing schema.

Plan complete and saved to `docs/superpowers/plans/2026-05-29-cloudflare-connector-expansion-implementation.md`.
