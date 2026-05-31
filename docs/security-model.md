# Security Model

This MVP is a local, CLI-first readiness assistant. It is designed to summarize control gaps and candidate evidence without becoming a hosted evidence vault or an automated configuration tool.

## Read-Only Connector Policy

GitHub, Vercel, and Cloudflare connectors must be read-only. They may collect metadata such as configuration presence, resource names, status flags, and API availability signals. They must not create, update, delete, rotate, deploy, approve, invite, revoke, or otherwise mutate remote resources.

Connector failures must be reported as uncertainty. A failed API call, missing token, missing permission, or unavailable endpoint should produce `needs_confirmation` scanner signals rather than a satisfied control judgment.

Cloudflare account scans may record product availability, counts, endpoint categories, permission status, and requirement IDs. They must not store account IDs, token values, Worker script names or code, Worker secret values, R2 bucket names or object keys, Hyperdrive database hosts, database names, database users, passwords, DNS content values, route hostnames, API operation paths, logs, request payloads, or user/admin identities.

The Cloudflare connector permission matrix and product-specific omit rules are maintained in [`docs/connectors/cloudflare.md`](connectors/cloudflare.md). That document is part of the public-safety contract: adding a new Cloudflare product scanner requires documenting the endpoint, read permission, retained metadata, omitted fields, and expected `needs_confirmation` behavior before publishing scan output.

## No Secret Storage

The tool must not store API tokens, secret values, private keys, session secrets, database URLs, bearer tokens, or environment variable values in scan outputs, reports, logs, or generated wiki files.

Scanners may record secret names or presence metadata when useful for readiness analysis, but secret values must be omitted or redacted.

Cloudflare API tokens must be supplied through `CLOUDFLARE_API_TOKEN`. The token is used only in the `Authorization` header and must never be written to scan JSON, evidence JSONL, reports, provenance logs, command output, or public exports.

## Private Evidence Boundary

Scanner output is not evidence acceptance. `isms-agent evidence index` turns scan signals into candidate evidence IDs, and `isms-agent evidence review` records human decisions in `reviews/evidence-review.jsonl`.

`isms-agent evidence review-cloudflare` is a local-only bulk review overlay for Cloudflare scanner evidence. It reads `evidence/index.jsonl`, writes append-only records to `reviews/evidence-review.jsonl`, and does not call Cloudflare APIs. Bulk Cloudflare review may write `needs_followup` or explicit `rejected` decisions, but it must not write `accepted`; accepted decisions require a separate manual review of operating evidence.

Accepted Cloudflare operating evidence must come from manual private-record review, not from scanner output alone. The templates under `docs/evidence-templates/cloudflare/` define the accepted criteria, private storage location, and public export rule for Cloudflare access review, change approval, and security review evidence before a human owner records an accepted decision.

Accepted review decisions require `--private-evidence <path>`, and that path must exist under `evidence/private/`. Review records store only the workspace-relative private path, and public reports omit private evidence paths and review rationale.

`isms-agent evidence add` registers existing private operating evidence as public-safe metadata. The command requires `--private-evidence evidence/private/...` to exist, but it does not store that path in `evidence/index.jsonl`. The private path is recorded only in an accepted review overlay, and public report/export paths omit it.

Evidence index locators should remain public-safe references. Do not put `evidence/private/...` paths in `evidence/index.jsonl`; use `--private-evidence` on the accepted review record instead.

The default workspace keeps real evidence local:

- `evidence/private/` for real evidence files,
- `reviews/` for review overlays,
- `scans/` for connector and local scan outputs,
- `reports/` for private reports.

These paths are ignored by default. Public artifacts should be produced through `isms-agent report --public`, `isms-agent evidence export-public`, and `isms-agent evidence validate --public`.

## Dogfood Note: 2026-05-29

Small-batch control expansion keeps real evidence local. The public repository includes curated control knowledge and public-safe documentation, while `evidence/private/`, `reviews/`, `scans/`, and `reports/` remain local workspace state unless a public-safe export command creates redacted output.

## No Customer Or Personal Data Collection

The MVP must not collect customer records, end-user records, employee personal data, incident payloads containing personal data, ticket bodies, chat exports, or other personal information.

Operating documents placed under `project/` should be curated by the user before scanning. Reports should describe control readiness and candidate evidence locations, not reproduce sensitive source contents.

## Source Provenance Requirements

Generated control knowledge must preserve source provenance. Control JSON and source indexes should identify:

- source path,
- source hash where available,
- source excerpt or heading,
- whether a judgment is observed, document-backed, inferred, user-confirmed, or `needs_confirmation`.

Reports must keep the distinction between source-backed facts, scanner observations, inference, and missing information. Evidence map language must say candidate evidence, not final audit evidence.

## Human Approval Boundaries

The CLI can draft gaps, tasks, and candidate evidence maps, but a human owner must approve governance decisions.

Human approval is required before:

- declaring a control satisfied,
- accepting risk,
- approving an exception,
- changing certification scope,
- relying on a policy as operational evidence,
- submitting evidence for certification use,
- deciding that candidate evidence is current, complete, and acceptable.

Technical configuration alone is not proof of control operation. Evidence existence is not control satisfaction.
