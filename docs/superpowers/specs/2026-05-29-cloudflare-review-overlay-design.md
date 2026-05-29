# Cloudflare Review Overlay Design

Date: 2026-05-29

## 1. Purpose

Cloudflare connector scans now produce public-safe candidate evidence for `ISMS-P-2.10.2 클라우드 보안`. The next step is to record a human review overlay that keeps those scanner outputs useful without overstating them as certification-ready evidence.

This design defines how Cloudflare candidate evidence should be reviewed, mapped to requirement-level evidence decisions, and kept out of public artifacts.

The key decision is:

```text
Cloudflare scan output is configuration evidence only.
Bulk review can mark it as needs_followup.
Bulk review must not auto-accept it as operating evidence.
```

## 2. Current State

The current CLI supports:

```bash
isms-agent evidence index
isms-agent evidence review <evidence-id> \
  --requirement <requirement-id> \
  --decision <accepted|rejected|needs_followup> \
  --rationale <text>
isms-agent evidence validate --public
```

After a Cloudflare scan, `evidence index` creates one candidate evidence item per scan signal. The current review command can review each evidence item one at a time, but that does not scale well once a connector produces many product signals.

The latest Cloudflare connector emits safe candidate signals for:

- zone,
- TLS mode,
- WAF/rulesets,
- Access apps,
- DNS records,
- API Gateway discovery,
- Workers,
- R2,
- Hyperdrive.

Public validation already ensures token values, account IDs, zone IDs, concrete API paths, private resource names, DNS content values, R2 object keys, Worker code, Hyperdrive database details, and user identities are not emitted.

## 3. Problem

Without a structured review overlay, three failure modes are likely:

1. A report reader may treat "Cloudflare setting observed" as "ISMS-P control satisfied".
2. A reviewer may accept evidence at the control level while missing requirement-level gaps such as admin access review or change approval.
3. A team may copy real Cloudflare scan outputs or review rationale into the public repo while trying to document progress.

The review overlay must make the conservative interpretation explicit:

- observed Cloudflare metadata can support a configuration-export requirement,
- observed Cloudflare metadata does not prove a policy exists,
- observed Cloudflare metadata does not prove changes were approved,
- observed Cloudflare metadata does not prove periodic reviews happened,
- observed Cloudflare metadata does not prove administrator access was reviewed.

## 4. Review Policy

### 4.1 Default Decision

Cloudflare bulk review defaults to:

```text
decision = "needs_followup"
```

Default rationale:

```text
Cloudflare configuration was observed by a read-only connector, but operating evidence is still required before this requirement can be treated as satisfied.
```

The default decision should be used for scanner-created Cloudflare evidence because scanner output is a candidate, not a final audit artifact.

### 4.2 Accepted Evidence

Bulk review must not write `decision: "accepted"` for Cloudflare scan evidence.

Accepted Cloudflare evidence requires a narrower, manual review record where a human owner confirms the exact requirement and the supporting operational artifact. Examples:

- a reviewed Cloudflare configuration export attached to a dated security review,
- a cloud administrator access review record,
- a change approval record for the relevant Cloudflare setting,
- a periodic cloud security review record with follow-up tracking.

The existing single-item `evidence review` command can remain the path for manual `accepted` decisions.

### 4.3 Rejected Evidence

Bulk `rejected` is allowed only when a reviewer explicitly states that a Cloudflare scan signal is not applicable or does not support the requirement. It should require an explicit rationale and should not be the default.

## 5. Requirement Mapping

The bulk review command should use the `supports` array already present in each `EvidenceItem`. For current Cloudflare evidence, the expected mapping is:

| Evidence signal | Default requirement mapping | Default review decision |
| --- | --- | --- |
| `ev_scan_cloudflare_cloudflare_zone` | `ISMS-P-2.10.2.cloudflare-config-export` | `needs_followup` |
| `ev_scan_cloudflare_cloudflare_tls_mode` | `ISMS-P-2.10.2.cloudflare-config-export` | `needs_followup` |
| `ev_scan_cloudflare_cloudflare_waf` | `ISMS-P-2.10.2.cloudflare-config-export` | `needs_followup` |
| `ev_scan_cloudflare_cloudflare_dns_records` | `ISMS-P-2.10.2.cloudflare-config-export` | `needs_followup` |
| `ev_scan_cloudflare_cloudflare_access_apps` | `ISMS-P-2.10.2.cloud-admin-access-review` | `needs_followup` |
| `ev_scan_cloudflare_cloudflare_workers` | `ISMS-P-2.10.2.cloudflare-config-export`, `ISMS-P-2.10.2.cloud-change-approval` | `needs_followup` |
| `ev_scan_cloudflare_cloudflare_r2` | `ISMS-P-2.10.2.cloudflare-config-export`, `ISMS-P-2.10.2.cloud-change-approval` | `needs_followup` |
| `ev_scan_cloudflare_cloudflare_hyperdrive` | `ISMS-P-2.10.2.cloudflare-config-export`, `ISMS-P-2.10.2.cloud-change-approval` | `needs_followup` |
| `ev_scan_cloudflare_cloudflare_api_gateway` | `ISMS-P-2.10.2.cloudflare-config-export`, `ISMS-P-2.10.2.cloud-change-approval` | `needs_followup` |

If a future connector emits additional Cloudflare evidence, bulk review should only review it when:

- `origin` is `scan`,
- `classification` is `confidential` or `internal`,
- `metadata.signal_source` is `cloudflare`,
- `supports` contains at least one requirement ID,
- `lifecycle_status` is `candidate`.

Unmapped evidence should be skipped and reported as a warning.

## 6. Command Design

### 6.1 Bulk Cloudflare Review

Add a connector-specific bulk review command:

```bash
isms-agent evidence review-cloudflare \
  --decision needs_followup \
  --reviewer security-owner \
  --rationale "Cloudflare configuration was observed by a read-only connector, but operating evidence is still required before this requirement can be treated as satisfied."
```

The command appends review records to:

```text
reviews/evidence-review.jsonl
```

For each eligible Cloudflare evidence item, it writes one review record per requirement in `supports`.

Example output:

```json
{
  "outputPath": "reviews/evidence-review.jsonl",
  "reviewedEvidence": 9,
  "reviewRecords": 12,
  "skippedEvidence": 0,
  "decision": "needs_followup"
}
```

### 6.2 Dry Run

The command should support a dry run:

```bash
isms-agent evidence review-cloudflare --dry-run
```

Dry run must not write files. It should show:

- evidence ID,
- title or summary,
- requirement IDs,
- proposed decision,
- whether the evidence is eligible,
- skip reason when not eligible.

### 6.3 Decision Guardrails

The command should reject:

```bash
isms-agent evidence review-cloudflare --decision accepted
```

Expected error:

```text
Cloudflare bulk review cannot auto-accept scanner evidence. Use evidence review <evidence-id> for a manual accepted decision.
```

`--decision rejected` is allowed only with an explicit non-empty `--rationale`.

### 6.4 Rationale Handling

The rationale is private review metadata. It may appear in `reviews/evidence-review.jsonl`, but it must not appear in public reports or public evidence exports.

The default rationale must avoid:

- token values,
- account IDs,
- zone IDs,
- resource names,
- hostnames,
- DNS values,
- R2 bucket names,
- Hyperdrive config names,
- Worker script names,
- personal data.

## 7. Review Record Shape

The command should reuse the existing `EvidenceReviewRecord` schema:

```ts
export interface EvidenceReviewRecord {
  schemaVersion: 1;
  reviewed_at: string;
  evidence_id: string;
  requirement_id: string;
  decision: "accepted" | "rejected" | "needs_followup";
  reviewer?: string;
  rationale: string;
  conditions?: string[];
  expires_at?: string;
  replacement_evidence_id?: string;
}
```

For Cloudflare bulk review, the first implementation should populate:

- `schemaVersion`,
- `reviewed_at`,
- `evidence_id`,
- `requirement_id`,
- `decision`,
- `reviewer` when provided,
- `rationale`.

It should not add a new schema version unless the existing schema cannot express the decision.

## 8. Report Semantics

After bulk review:

- `evidence validate --public` should no longer warn that Cloudflare candidate evidence lacks a review decision.
- `report --public` should still show `ISMS-P-2.10.2` as `partial` unless separate operating evidence is accepted.
- Evidence map language should remain "candidate exists" and "configuration only" for scanner evidence.
- Public reports must not reveal review rationale, private paths, raw scan payloads, or Cloudflare resource identifiers.

The review overlay should reduce ambiguity, not inflate readiness.

## 9. Safety Rules

- Do not read Cloudflare APIs in the review command. It operates only on local `evidence/index.jsonl`.
- Do not modify scan files.
- Do not modify evidence items in place.
- Append review records only.
- Keep `reviews/` ignored by git.
- Keep public exports dependent on `evidence validate --public`.
- Treat scanner evidence as stale unless a reviewer confirms recency through a later manual accepted record.

## 10. Implementation Notes

The implementation should add a focused helper rather than embedding bulk review logic in the CLI parser.

Recommended files:

```text
src/commands/evidence.ts
src/cli.ts
test/commands/evidence.test.ts
README.md
docs/security-model.md
```

Possible internal API:

```ts
export interface CloudflareEvidenceReviewOptions {
  decision?: "needs_followup" | "rejected";
  rationale?: string;
  reviewer?: string;
  dryRun?: boolean;
  reviewedAt?: Date;
}

export interface CloudflareEvidenceReviewResult {
  outputPath?: string;
  reviewedEvidence: number;
  reviewRecords: number;
  skippedEvidence: number;
  decision: "needs_followup" | "rejected";
  records: EvidenceReviewRecord[];
  skipped: Array<{ evidence_id: string; reason: string }>;
}
```

`reviewCloudflareEvidence(workspaceRoot, options)` should:

1. load `evidence/index.jsonl`,
2. filter eligible Cloudflare candidate evidence,
3. create one review record per supported requirement,
4. append records to `reviews/evidence-review.jsonl` unless `dryRun` is true,
5. return counts and skipped reasons.

## 11. Testing

Automated tests should cover:

- dry run returns proposed records and does not create `reviews/evidence-review.jsonl`,
- `needs_followup` appends one review record per Cloudflare evidence requirement,
- `accepted` is rejected for bulk Cloudflare review,
- unmapped Cloudflare evidence is skipped with a warning or skipped reason,
- non-Cloudflare evidence is skipped,
- public validation warnings disappear after bulk review records exist,
- public validation still passes,
- review rationale is omitted from public reports.

## 12. Acceptance Criteria

- `isms-agent evidence review-cloudflare --dry-run` previews eligible Cloudflare evidence without writing files.
- `isms-agent evidence review-cloudflare --decision needs_followup --reviewer <name>` appends review overlay records.
- The command cannot auto-accept Cloudflare scanner evidence.
- `evidence validate --public` passes after review overlay creation.
- `report --public` remains conservative and does not mark `ISMS-P-2.10.2` satisfied from scanner evidence alone.
- `npm test`, `npm run check`, `node dist/cli.js pack validate`, `node dist/cli.js evidence validate --public`, and `git diff --check` pass.
