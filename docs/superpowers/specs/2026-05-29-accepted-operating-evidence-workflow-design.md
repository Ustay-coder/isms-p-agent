# Accepted Operating Evidence Workflow Design

## Problem

The CLI already distinguishes scanner evidence from human review decisions, but the single-item `evidence review` command can still write `decision: "accepted"` with only a rationale string. That is too weak for ISMS-P operating evidence because an agent or operator could accept candidate scanner output without linking it to a real private operating record.

## Decision

Accepted review decisions must require a private operating evidence reference.

The first implementation stays local-first and narrow:

- `isms-agent evidence review ... --decision accepted` must include `--private-evidence <path>`.
- The referenced path must exist inside the workspace.
- The referenced path must be under `evidence/private/`.
- The review record stores only the workspace-relative private path.
- Evidence index locators must stay public-safe; private paths belong in review records, not `evidence/index.jsonl`.
- Public reports and public exports must not expose the private evidence path.
- `needs_followup` and `rejected` reviews do not require private evidence.

## Non-Goals

- Do not upload evidence.
- Do not create a hosted evidence vault.
- Do not parse private evidence contents.
- Do not mark scanner output accepted through `review-cloudflare`.
- Do not commit private evidence, review overlays, scans, or reports.

## Data Model

Extend `EvidenceReviewRecord` with:

```ts
private_evidence_path?: string;
```

The value must be a normalized workspace-relative path such as:

```text
evidence/private/ISMS-P-2.10.2/security-review/2026-Q2.md
```

## CLI Contract

Accepted:

```bash
isms-agent evidence review ev_cloudflare_security_review_2026_q2 \
  --requirement ISMS-P-2.10.2.cloudflare-config-export \
  --decision accepted \
  --private-evidence evidence/private/ISMS-P-2.10.2/security-review/2026-Q2.md \
  --rationale "Private Cloudflare security review confirmed by security owner." \
  --reviewer security-owner
```

Rejected or follow-up:

```bash
isms-agent evidence review ev_scan_cloudflare_cloudflare_waf \
  --requirement ISMS-P-2.10.2.cloudflare-config-export \
  --decision needs_followup \
  --rationale "Operating evidence still required." \
  --reviewer security-owner
```

## Validation Rules

`evidence validate` and `evidence validate --public` must report issues when:

- an accepted review record has no `private_evidence_path`,
- `private_evidence_path` points outside the workspace,
- `private_evidence_path` is not under `evidence/private/`,
- `private_evidence_path` does not exist.

The existing public validator already rejects git-tracked private paths, so this workflow keeps the evidence local while still proving that accepted decisions have a private backing record.

## Public Output

Public report review summaries may include:

- evidence id,
- requirement id,
- decision,
- expiration date,
- classification,
- redacted rationale placeholder.

Public output must not include:

- `private_evidence_path`,
- `evidence/private/...` locators from evidence index rows,
- private evidence filenames,
- private review rationale,
- private artifact contents.

## Acceptance Criteria

- `reviewEvidence()` rejects accepted decisions without `privateEvidencePath`.
- `reviewEvidence()` rejects accepted decisions whose private path is outside `evidence/private/`.
- `reviewEvidence()` rejects accepted decisions whose private path does not exist.
- `reviewEvidence()` writes `private_evidence_path` for accepted decisions.
- `validateEvidence()` rejects accepted review records without valid private evidence references.
- Public reports still omit private evidence paths and private rationale.
- `review-cloudflare --decision accepted` remains rejected.
