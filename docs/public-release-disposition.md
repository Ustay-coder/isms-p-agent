# Public Release Disposition Register

This register defines which tracked documentation and example files are intended for the early-preview open-source release.

Disposition values:

- `keep-public`: safe and intended to remain public.
- `sanitize-public`: safe only after the noted cleanup is complete.
- `exclude-release`: generated or local workspace material that must not be committed.
- `private-history`: internal planning or dogfood history that should be removed from the public release branch unless reclassified in a future review.

## Release Scope

The public release is allowed to include:

- CLI source code, tests, and synthetic fixtures.
- Public docs that explain architecture, safety boundaries, and contribution rules.
- Reviewed `packs/isms-p-core-v0` control-pack content.
- Synthetic examples under `examples/`.

The public release must not include:

- real service evidence, scan outputs, reports, or review overlays,
- private local workspace paths,
- secrets, tokens, credentials, account IDs, customer records, or PII,
- private dogfood analysis from any real service,
- claims that this project certifies a service.

## Top-Level Markdown

| Path | Disposition | Notes |
| --- | --- | --- |
| `README.md` | `keep-public` | English-first early-preview overview, Quickstart, architecture flow, and Korean summary. |
| `CONTRIBUTING.md` | `keep-public` | Contribution rules for control packs, evidence boundaries, and tests. |
| `SECURITY.md` | `keep-public` | Vulnerability reporting and public-safety boundaries. |
| `CODE_OF_CONDUCT.md` | `keep-public` | Community behavior and privacy expectations. |

## Public Docs

| Path | Disposition | Notes |
| --- | --- | --- |
| `docs/public-release-disposition.md` | `keep-public` | This register. |
| `docs/control-pack-contributions.md` | `keep-public` | Public guide for source-traceable control-pack contributions. |
| `docs/security-model.md` | `keep-public` | Local-first, no-secrets, private-evidence, and candidate-evidence boundaries. |
| `docs/connectors/cloudflare.md` | `keep-public` | Public endpoint matrix and token guidance using generic sample-service examples. |
| `docs/evidence-templates/cloudflare/ISMS-P-2.10.2-cloud-admin-access-review.md` | `keep-public` | Template only; no real evidence. |
| `docs/evidence-templates/cloudflare/ISMS-P-2.10.2-cloud-change-approval.md` | `keep-public` | Template only; no real evidence. |
| `docs/evidence-templates/cloudflare/ISMS-P-2.10.2-cloud-security-review.md` | `keep-public` | Template only; no real evidence. |

## Examples

| Path | Disposition | Notes |
| --- | --- | --- |
| `examples/e2e-sample/project/sample-service/security-notes.md` | `keep-public` | Synthetic fixture for public CLI smoke tests; not real operational evidence. |

## Private-History Planning Docs

These files were useful for project planning but are not part of the early-preview public release surface. They should be removed from the public release branch unless a future PR rewrites them as stable public design docs.

| Path | Disposition | Notes |
| --- | --- | --- |
| `docs/superpowers/plans/2026-05-23-isms-p-agent-mvp-implementation.md` | `private-history` | Historical implementation plan. |
| `docs/superpowers/plans/2026-05-28-agent-ask-context-implementation.md` | `private-history` | Historical implementation plan. |
| `docs/superpowers/plans/2026-05-28-control-knowledge-pack-v0-implementation.md` | `private-history` | Historical implementation plan. |
| `docs/superpowers/plans/2026-05-28-openkb-pack-generator-implementation.md` | `private-history` | Historical implementation plan. |
| `docs/superpowers/plans/2026-05-29-accepted-operating-evidence-workflow-implementation.md` | `private-history` | Historical implementation plan. |
| `docs/superpowers/plans/2026-05-29-cloudflare-connector-expansion-implementation.md` | `private-history` | Historical implementation plan. |
| `docs/superpowers/plans/2026-05-29-cloudflare-review-overlay-implementation.md` | `private-history` | Historical implementation plan. |
| `docs/superpowers/plans/2026-05-29-control-expansion-implementation.md` | `private-history` | Historical implementation plan. |
| `docs/superpowers/plans/2026-05-29-evidence-add-implementation.md` | `private-history` | Historical implementation plan. |
| `docs/superpowers/plans/2026-05-29-small-batch-control-expansion-implementation.md` | `private-history` | Historical implementation plan. |
| `docs/superpowers/specs/2026-05-23-isms-p-agent-mvp-design.md` | `private-history` | Historical design note. |
| `docs/superpowers/specs/2026-05-28-agent-ask-context-design.md` | `private-history` | Historical design note. |
| `docs/superpowers/specs/2026-05-28-control-knowledge-pack-v0-design.md` | `private-history` | Historical design note. |
| `docs/superpowers/specs/2026-05-28-openkb-pack-generation-pipeline-design.md` | `private-history` | Historical design note. |
| `docs/superpowers/specs/2026-05-28-private-evidence-store-design.md` | `private-history` | Historical design note. |
| `docs/superpowers/specs/2026-05-29-accepted-operating-evidence-workflow-design.md` | `private-history` | Historical design note. |
| `docs/superpowers/specs/2026-05-29-cloudflare-connector-expansion-design.md` | `private-history` | Historical design note. |
| `docs/superpowers/specs/2026-05-29-cloudflare-review-overlay-design.md` | `private-history` | Historical design note. |
| `docs/superpowers/specs/2026-05-29-evidence-add-design.md` | `private-history` | Historical design note. |
| `docs/superpowers/specs/2026-05-29-small-batch-control-expansion-design.md` | `private-history` | Historical design note. |

## Local Workspace Artifacts

These paths are expected during real use but must stay out of the public release branch unless they are synthetic fixtures under `examples/` or `test/fixtures/`:

- `raw/`
- `wiki/`
- `controls/`
- `project/`
- `connectors/`
- `scans/`
- `reports/`
- `evidence/`
- `reviews/`
- `isms-agent.config.json`
- `log.md`
- `AGENTS.md`
- `.omx/`

## Audit Command

Use this command before publishing:

```bash
npm run scan:public
```

The scanner checks tracked files plus untracked non-ignored files for private workspace artifact paths, credential-like values, local absolute paths, and known private dogfood identifiers. Any hit must be removed or sanitized before the branch is made public.
