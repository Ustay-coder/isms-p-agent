# Cloudflare Connector Expansion Design

Date: 2026-05-29

## 1. Decision

Cloudflare connector expansion should happen after the private evidence layer because Cloudflare account metadata can expose sensitive infrastructure shape even when API calls are read-only.

The next connector PR should keep the existing zone scan compatible and add opt-in account-level products:

```bash
isms-agent scan \
  --cloudflare example.com \
  --cloudflare-account <account_id> \
  --cloudflare-products zone,access,waf,dns,workers,r2,hyperdrive,api-gateway
```

The connector must continue to emit public-safe `ScanSignal` records by default. Richer connector snapshots, if added, must be represented as private `EvidenceItem` records with `classification: "confidential"` and must pass `evidence validate --public` before public release.

## 2. Current State

The current implementation in `src/connectors/cloudflare.ts` accepts:

```text
--cloudflare <zone-or-zone-id>
```

It reads only:

- zone metadata,
- TLS/SSL mode,
- rulesets/WAF availability,
- Cloudflare Access app count,
- DNS record counts and record types.

It does not read Workers, R2, Hyperdrive, API Gateway, routes, deployments, object lists, logs, secrets, or account-level posture.

## 3. Product Scope

Phase 1 should add account-level inventory signals without raw payload retention:

- Workers: script count, route presence, deployment/version presence, observability flag if safely available.
- R2: bucket count and public access posture when available. Do not list objects.
- Hyperdrive: config count and safe posture fields. Do not store database host, database name, user, password, or connection strings.
- API Gateway: discovery/schema-validation presence and operation counts only.
- Access: app/policy counts and zone/account coverage only. Do not store user identities.

Phase 1 should not mutate settings, deploy Workers, rotate secrets, list logs, list R2 objects, or fetch customer/request payloads.

## 4. Scan Signal Conventions

Cloudflare scan metadata should use an allowlist. Unknown fields from API responses are dropped.

Recommended metadata keys:

```text
product
endpoint
permission_status
requirement_ids
snapshot_id
sensitivity
count
available
```

The initial requirement mapping should target Cloudflare-related requirements such as:

```text
ISMS-P-2.10.2.cloudflare-config-export
ISMS-P-2.10.2.cloud-admin-access-review
ISMS-P-2.10.2.cloud-change-approval
```

`needs_confirmation` remains the correct result for missing token, missing account ID, 403 permission errors, unsupported endpoints, or network failure.

## 5. Safety Rules

- Only `GET` requests are allowed.
- Tokens are sent only in the `Authorization` header.
- Token values, Worker secrets, environment variable values, database hosts, database names, database users, R2 object keys, DNS content values, logs, request payloads, and user/admin identities must not appear in scans or reports.
- Zone names, route patterns, bucket names, Hyperdrive config names, and account IDs are at least internal metadata and should not be emitted in public reports unless explicitly curated as public samples.
- Public reports and exports must show evidence IDs and safe summaries rather than raw connector responses.

## 6. Implementation Plan

1. Extend `CloudflareInput` with optional `accountId` and `products`.
2. Extend CLI parsing with `--cloudflare-account` and `--cloudflare-products`.
3. Add a small Cloudflare API client helper for GET-only calls, pagination, and 403-to-`needs_confirmation` handling.
4. Add product scanners as isolated functions with allowlist serializers.
5. Emit `requirement_ids` metadata where the mapping is clear.
6. Add tests that prove unsafe fields are omitted.
7. Update README and `docs/security-model.md` with token scopes and retained/omitted data.

## 7. Verification

Required checks for the implementation PR:

```bash
npm test
npm run check
node dist/cli.js pack validate
node dist/cli.js evidence validate --public
```

Additional connector-specific test cases:

- Workers, R2, Hyperdrive, and API Gateway signals are emitted from fixture responses.
- Pagination is handled deterministically.
- Missing account ID returns `needs_confirmation` for account-level products.
- 403 returns `needs_confirmation`, not a crash.
- Token values and raw API bodies never appear in `ScanSignal`.
- R2 object keys, Worker secret values, DNS content values, database hosts, and user identities are omitted.
