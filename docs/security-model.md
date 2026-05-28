# Security Model

This MVP is a local, CLI-first readiness assistant. It is designed to summarize control gaps and candidate evidence without becoming a hosted evidence vault or an automated configuration tool.

## Read-Only Connector Policy

GitHub, Vercel, and Cloudflare connectors must be read-only. They may collect metadata such as configuration presence, resource names, status flags, and API availability signals. They must not create, update, delete, rotate, deploy, approve, invite, revoke, or otherwise mutate remote resources.

Connector failures must be reported as uncertainty. A failed API call, missing token, missing permission, or unavailable endpoint should produce `needs_confirmation` scanner signals rather than a satisfied control judgment.

## No Secret Storage

The tool must not store API tokens, secret values, private keys, session secrets, database URLs, bearer tokens, or environment variable values in scan outputs, reports, logs, or generated wiki files.

Scanners may record secret names or presence metadata when useful for readiness analysis, but secret values must be omitted or redacted.

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
