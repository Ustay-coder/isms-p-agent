# ISMS-P Agent

ISMS-P Agent is an open source, CLI-first ISMS-P readiness assistant for startup SaaS teams preparing for certification readiness work.

The MVP helps a team turn source material, operating documents, repository metadata, and read-only SaaS metadata into practical next steps:

- a remediation backlog,
- a control gap report,
- an evidence map that lists candidate evidence only.

It does not create final audit evidence, mutate SaaS settings, store secrets, collect customer data, or replace human control-owner review.

## Implementation Approach

- Markdown wiki: source-oriented notes and generated source indexes stay readable and reviewable.
- JSON control model: ingested controls are structured for deterministic analysis and report generation.
- Read-only scanners: local repo, local operating documents, GitHub, Vercel, and Cloudflare collectors produce metadata signals without applying changes.
- Conservative analyzer: missing or failed scanner coverage becomes `needs_confirmation` instead of a false pass.
- Markdown reports: generated outputs are simple files that can be reviewed, versioned, and edited outside the tool.

## Architecture Flow

```mermaid
flowchart TD
  A["raw/ source documents"] --> B["ingest"]
  B --> C["wiki/ source indexes"]
  B --> D["controls/*.json"]
  Q["packs/isms-p-core-v0"] --> R["pack validate"]
  R --> X["pack install"]
  X --> D
  E["project/ operating documents"] --> F["scan --local"]
  G["local repository metadata"] --> F
  H["GitHub, Vercel, Cloudflare metadata"] --> I["read-only connector scans"]
  F --> J["scans/*.json"]
  I --> J
  J --> S["evidence index"]
  S --> T["evidence/index.jsonl"]
  T --> U["human evidence review"]
  U --> V["reviews/evidence-review.jsonl"]
  D --> K["conservative analyzer"]
  J --> K
  T --> K
  V --> K
  K --> L["reports/backlog.md"]
  K --> M["reports/control-gap-report.md"]
  K --> N["reports/evidence-map.md"]
  K --> W["public report/export guard"]
  D --> O["ask-context"]
  J --> O
  O --> P["Codex or Claude Code grounded answer"]
```

The intended flow is:

1. Keep official and user-provided sources under `raw/`.
2. Ingest Markdown sources into `controls/` JSON and `wiki/` source indexes with provenance.
3. Scan local files and optional SaaS metadata in read-only mode.
4. Convert scanner signals into candidate evidence IDs with `evidence index`.
5. Record human review decisions in the append-only review overlay.
6. Generate Markdown reports that separate observed state, uncertainty, gaps, candidate evidence, and accepted review decisions.
7. Use public validation/export commands before publishing any example output.

## MVP Workflow

```bash
npm install
npm run build
npm test
npm link
isms-agent pack validate
isms-agent init
isms-agent ingest raw/example.md
isms-agent scan --local
isms-agent scan --local --target project/evaluation
isms-agent scan --local --target project/evaluation --include app,services,repositories,db,lib,specs --exclude __tests__
isms-agent scan --cloudflare example.com
isms-agent scan \
  --cloudflare example.com \
  --cloudflare-account account_123 \
  --cloudflare-products zone,access,waf,dns,workers,r2,hyperdrive,api-gateway
isms-agent evidence index
isms-agent evidence review ev_scan_local_docs_auth_mfa \
  --requirement ISMS-P-2.5.3.admin-mfa \
  --decision needs_followup \
  --rationale "Production enforcement record is still required."
isms-agent report
isms-agent report --public
isms-agent evidence export-public
isms-agent evidence validate --public
isms-agent ask-context "2.5.3 사용자 인증 상태 알려줘"
```

Generated workspace directories:

```text
raw/          immutable source documents
wiki/         generated source indexes and knowledge notes
controls/     structured control JSON
project/      service context and operating documents
connectors/   connector configuration notes
scans/        scanner JSON outputs
reports/      Markdown backlog, gap report, and evidence map
evidence/     private evidence pointers and redacted public samples
reviews/      human review overlays for evidence and applicability
```

Use `--target <path>` when the workspace contains multiple services or copied repositories. Local scanner paths remain relative to the ISMS-P workspace root, but file discovery is limited to the target directory. Use `--include` and `--exclude` with comma-separated, target-relative paths to narrow the scan to source, specs, or operating documents. The scanner also skips common dependency, build, report, planning/cache, and agent-runtime directories such as `node_modules`, `.next`, `.open-next`, `.planning`, `.claude`, `.playwright-mcp`, `scans`, and `reports`.

Cloudflare scans require `CLOUDFLARE_API_TOKEN` and are read-only. Zone-only scans keep the legacy shape:

```bash
CLOUDFLARE_API_TOKEN=... isms-agent scan --cloudflare example.com
```

Account product scans are opt-in:

```bash
CLOUDFLARE_API_TOKEN=... isms-agent scan \
  --cloudflare example.com \
  --cloudflare-account account_123 \
  --cloudflare-products zone,access,waf,dns,workers,r2,hyperdrive,api-gateway
```

Cloudflare connector output is candidate metadata, not accepted audit evidence. It records product availability, counts, permission status, and requirement mappings only. Continue through the evidence review flow before using it in readiness decisions:

```bash
isms-agent evidence index
isms-agent evidence review-cloudflare \
  --decision needs_followup \
  --reviewer security-owner
isms-agent evidence validate --public
```

`review-cloudflare` is a bulk overlay for Cloudflare scanner output. It marks configuration snapshots as `needs_followup` by default and writes one private review record per supported requirement. Bulk review can record only `needs_followup` or an explicit `rejected` decision for Cloudflare scanner output; it cannot create `accepted` decisions. Use `isms-agent evidence review <evidence-id>` only after a human owner confirms operating evidence such as an access review, change approval, or dated cloud security review.

Accepted Cloudflare evidence is a manual operating-evidence decision. Before recording `--decision accepted`, use the private templates in [docs/evidence-templates/cloudflare/](docs/evidence-templates/cloudflare/) to confirm accepted criteria, private storage, and public export rules. Scanner output alone is not enough to accept ISMS-P-2.10.2 operating evidence.

Accepted decisions must reference an existing local private evidence file or directory under `evidence/private/`:

```bash
isms-agent evidence review ev_cloudflare_security_review_2026_q2 \
  --requirement ISMS-P-2.10.2.cloudflare-config-export \
  --decision accepted \
  --private-evidence evidence/private/ISMS-P-2.10.2/security-review/2026-Q2.md \
  --rationale "Private Cloudflare security review confirmed by the security owner." \
  --reviewer security-owner
```

Keep the private file path out of `evidence/index.jsonl` locators. Use a public-safe locator such as an internal reference ID, and let the accepted review record carry the private path through `--private-evidence`.

Manual operating evidence can be registered without exposing private paths:

```bash
isms-agent evidence add \
  --id ev_manual_auth_policy_2026_q2 \
  --title "Authentication policy 2026 Q2" \
  --type policy_document \
  --classification internal \
  --supports ISMS-P-2.5.3.authentication-policy \
  --private-evidence evidence/private/ISMS-P-2.5.3/authentication-policy/2026-Q2.md \
  --summary "Authentication policy reviewed for 2026 Q2."
```

`evidence add` does not create or approve evidence. It registers an existing private file or directory as `needs_review` metadata. Use `evidence review --decision accepted --private-evidence ...` only after a human control owner confirms the evidence.

See [docs/connectors/cloudflare.md](docs/connectors/cloudflare.md) for the current endpoint matrix, least-privilege token shape, omitted-field rules, and evaluation service dry-run flow.

## Natural-Language Questions with Agents

The CLI does not need a separate LLM API key for natural-language answers. Instead, it exposes a grounded context bundle that Codex, Claude Code, or another local coding agent can read and turn into an answer.

```bash
isms-agent ask-context "2.5.3 사용자 인증 상태 알려줘"
isms-agent ask-context "이번 주 먼저 처리할 항목은?" --markdown
isms-agent ask-context "사용자 인증 증적은 무엇이 부족해?"
```

Default output is JSON for agent callers. `--markdown` prints the same context in a compact human-readable form.

The command is read-only. It reuses the existing conservative analyzer, returns candidate evidence only, and includes answer constraints so the calling agent does not claim certification readiness from evidence existence alone.

## Private Evidence and Public Safety

Evidence found by scanners is candidate evidence only. Real service evidence should stay in the local workspace and should not be committed to the public repository.

`isms-agent init` creates private evidence directories and default ignore rules:

```text
evidence/private/  real evidence files, ignored by default
evidence/redacted/ optional sanitized examples
reviews/           human review overlay records, ignored by default
```

Run the public safety gate before publishing examples or reports:

```bash
isms-agent evidence export-public
isms-agent report --public
isms-agent evidence validate --public
```

The validator fails when private evidence, scans, reports, or review overlays are tracked by git, or when public evidence metadata contains unsafe classifications or credential-like values. `report --public` and `evidence export-public` omit locators, raw payloads, source excerpts, private paths, and review rationale.

## Control Knowledge Pack v0

The first curated pack is `packs/isms-p-core-v0`. It uses the local OpenKB ISMS-P workspace as the source of truth and includes eight controls.

The direct pack sources are OpenKB `compiled/controls`, `compiled/citations`, `compiled/evidence`, and public `wiki` notes. Raw legal profile rows such as `raw/legal/7의2...` are kept only as source-profile cross-check references because their numbering can differ from the compiled OpenKB control IDs.

- `ISMS-P-2.5.3 사용자 인증`
- `ISMS-P-2.5.6 접근권한 검토`
- `ISMS-P-2.10.2 클라우드 보안`

### Generating Draft Packs from OpenKB

Maintainers can generate a draft pack from a local OpenKB root:

```bash
isms-agent pack generate \
  --openkb /path/to/09_보안_ISMS-P_openkb \
  --pack packs/isms-p-core-v1 \
  --controls ISMS-P-2.5.3,ISMS-P-2.5.6

isms-agent pack validate packs/isms-p-core-v1
```

Generated packs are draft knowledge. Every generated control starts with `review_status: needs_human_review`, uses compiled/wiki OpenKB sources as direct source refs, and keeps `raw/legal/*` rows as cross-check references only.

Validate the pack before copying it into a workspace:

```bash
isms-agent pack validate
isms-agent pack validate packs/isms-p-core-v0
```

The validator rejects public-pack safety problems such as private overlay paths, raw legal profile rows used as direct `source_refs`, mismatched `pack.json` control lists, missing compiled OpenKB references, and deleted controls that are not modeled as human-reviewed residual risk.

Install a curated pack into a workspace before generating reports:

```bash
isms-agent pack install packs/isms-p-core-v0
isms-agent scan --local
isms-agent evidence index
isms-agent report
```

Use `--overwrite` only when you intentionally want curated pack controls to replace local workspace controls:

```bash
isms-agent pack install packs/isms-p-core-v0 --overwrite
```

`pack install` validates the pack first, then copies public control JSON files into `controls/`. `installedControls` means controls that are now present and up to date after the install, including pre-existing files that already matched the pack. `skippedControls` means existing local files were preserved because they differ from the pack and `--overwrite` was not requested.

If files already exist, review them before replacing local workspace controls.

`ISMS-P-2.5.6 접근권한 검토` is modeled as a deleted residual-risk control. The CLI should ask for residual-risk review, not treat it as a normal active-control gap.

## Safety Model

Read [docs/security-model.md](docs/security-model.md) before using the CLI with real service material.

Key defaults:

- connectors are read-only,
- secrets are not stored,
- customer records and personal data are out of scope,
- source provenance is required for generated control knowledge,
- human approval is required before treating candidate evidence as certification-ready evidence.
