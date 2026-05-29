# Cloudflare Review Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `isms-agent evidence review-cloudflare` so Cloudflare connector evidence can be bulk-reviewed as `needs_followup` or explicitly `rejected` without ever auto-accepting scanner output.

**Architecture:** Keep the CLI parser thin and add `reviewCloudflareEvidence()` in `src/commands/evidence.ts`. The helper loads local `evidence/index.jsonl`, filters Cloudflare scan candidates, creates one append-only `EvidenceReviewRecord` per supported requirement, and writes to `reviews/evidence-review.jsonl` unless `--dry-run` is set. Public validation and reporting stay conservative: review rationale remains private, and Cloudflare scan output remains candidate/configuration evidence until a human uses single-item review to accept operating evidence.

**Tech Stack:** TypeScript, Node.js 22 built-in test runner, existing JSONL evidence/review schema, existing `isms-agent evidence/report` workflow.

---

## Scope

Included:
- Add `reviewCloudflareEvidence(workspaceRoot, options)` to `src/commands/evidence.ts`.
- Add `isms-agent evidence review-cloudflare [--decision needs_followup|rejected] [--rationale text] [--reviewer name] [--dry-run]`.
- Default bulk decision to `needs_followup`.
- Default rationale to the public-safe text from the SPEC.
- Reject `--decision accepted` with the exact guardrail message from the SPEC.
- Require explicit non-empty `--rationale` for `--decision rejected`.
- Append one review record per `(Cloudflare evidence item, requirement_id in supports)`.
- Return skipped evidence with reasons for non-Cloudflare, non-scan, non-candidate, unsafe classification, and missing support mappings.
- Prove `evidence validate --public` warnings disappear after bulk review records exist.
- Prove public reports omit private review rationale and still treat scanner evidence conservatively.
- Document the new command in `README.md` and `docs/security-model.md`.

Excluded:
- Calling Cloudflare APIs from the review command.
- Mutating scan files.
- Mutating `evidence/index.jsonl`.
- Creating accepted review records through bulk Cloudflare review.
- Publishing `reviews/evidence-review.jsonl` or rationale in public artifacts.

## File Structure

- Modify `src/commands/evidence.ts`
  - Add `DEFAULT_CLOUDFLARE_REVIEW_RATIONALE`.
  - Add `CloudflareEvidenceReviewOptions` and `CloudflareEvidenceReviewResult`.
  - Add `reviewCloudflareEvidence()`.
  - Add small private helpers for eligibility, decision validation, record construction, and append formatting.

- Modify `src/cli.ts`
  - Import `reviewCloudflareEvidence`.
  - Add `evidence review-cloudflare` branch before the generic `evidence review` branch.
  - Add `parseCloudflareEvidenceReviewArgs()`.
  - Update usage text.

- Modify `test/commands/evidence.test.ts`
  - Import `access` from `node:fs/promises` if needed for dry-run write assertions.
  - Import `reviewCloudflareEvidence`.
  - Add direct unit tests for the helper.
  - Add CLI tests for `review-cloudflare`.
  - Add report/public-rationale regression test if no existing report test covers it.

- Modify `README.md`
  - Replace or supplement the one-by-one Cloudflare review example with the bulk command.
  - State that bulk Cloudflare review can only mark scanner evidence as `needs_followup` or `rejected`.

- Modify `docs/security-model.md`
  - Document that review overlays are private, append-only, and local-first.
  - Document that Cloudflare bulk review does not call Cloudflare APIs and cannot auto-accept evidence.

---

### Task 0: Baseline and Spec Check

**Files:**
- Read: `docs/superpowers/specs/2026-05-29-cloudflare-review-overlay-design.md`
- Read: `src/commands/evidence.ts`
- Read: `src/cli.ts`
- Read: `test/commands/evidence.test.ts`

- [ ] **Step 1: Confirm clean starting point**

Run:

```bash
git status --short --branch
```

Expected:
- Current branch is the review overlay implementation branch.
- No unrelated modified files are present.

- [ ] **Step 2: Run the current baseline**

Run:

```bash
npm test
```

Expected:
- PASS with the current test suite before implementation.

- [ ] **Step 3: Keep the safety invariant visible while coding**

Read this SPEC sentence before writing implementation:

```text
Cloudflare scan output is configuration evidence only.
Bulk review can mark it as needs_followup.
Bulk review must not auto-accept it as operating evidence.
```

Expected:
- No task below creates `decision: "accepted"` from the bulk helper.

---

### Task 1: Add Cloudflare Bulk Review Helper Tests

**Files:**
- Modify: `test/commands/evidence.test.ts`

- [ ] **Step 1: Add the helper import**

Change the evidence command import near the top of `test/commands/evidence.test.ts` to include `reviewCloudflareEvidence`:

```ts
import { exportPublicEvidence, indexEvidenceFromScan, reviewCloudflareEvidence, reviewEvidence, validateEvidence } from "../../src/commands/evidence.js";
```

- [ ] **Step 2: Add a Cloudflare fixture helper**

Append this helper near the existing `scanResult()` helper:

```ts
function cloudflareEvidenceRows(): EvidenceItem[] {
  return [
    evidence({
      evidence_id: "ev_scan_cloudflare_cloudflare_waf",
      title: "Cloudflare candidate: WAF rulesets observed.",
      evidence_type: "connector_snapshot",
      classification: "confidential",
      lifecycle_status: "candidate",
      origin: "scan",
      supports: ["ISMS-P-2.10.2.cloudflare-config-export"],
      locator: { kind: "scan_signal", value: "cloudflare:waf" },
      summary: "Cloudflare WAF rulesets were observed.",
      metadata: { signal_source: "cloudflare", product: "waf" }
    }),
    evidence({
      evidence_id: "ev_scan_cloudflare_cloudflare_workers",
      title: "Cloudflare candidate: Workers observed.",
      evidence_type: "connector_snapshot",
      classification: "confidential",
      lifecycle_status: "candidate",
      origin: "scan",
      supports: ["ISMS-P-2.10.2.cloudflare-config-export", "ISMS-P-2.10.2.cloud-change-approval"],
      locator: { kind: "scan_signal", value: "cloudflare:workers" },
      summary: "Cloudflare Workers metadata was observed.",
      metadata: { signal_source: "cloudflare", product: "workers" }
    }),
    evidence({
      evidence_id: "ev_manual_policy",
      origin: "manual",
      supports: ["ISMS-P-2.10.2.cloud-policy"],
      metadata: {}
    }),
    evidence({
      evidence_id: "ev_scan_github_branch_protection",
      evidence_type: "connector_snapshot",
      classification: "confidential",
      lifecycle_status: "candidate",
      origin: "scan",
      supports: ["ISMS-P-2.5.6.access-review"],
      locator: { kind: "scan_signal", value: "github:branch-protection" },
      metadata: { signal_source: "github" }
    }),
    evidence({
      evidence_id: "ev_scan_cloudflare_unmapped",
      evidence_type: "connector_snapshot",
      classification: "confidential",
      lifecycle_status: "candidate",
      origin: "scan",
      supports: [],
      locator: { kind: "scan_signal", value: "cloudflare:unmapped" },
      metadata: { signal_source: "cloudflare", product: "future-product" }
    })
  ];
}
```

- [ ] **Step 3: Add dry-run test**

Add this test before the existing single-item `reviewEvidence` tests:

```ts
test("reviewCloudflareEvidence dry run proposes records without writing review files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-review-cloudflare-dry-run-"));
  try {
    await mkdir(join(dir, "evidence"), { recursive: true });
    await writeFile(join(dir, "evidence", "index.jsonl"), cloudflareEvidenceRows().map((row) => JSON.stringify(row)).join("\n") + "\n");

    const result = await reviewCloudflareEvidence(dir, {
      dryRun: true,
      reviewer: "security-owner",
      reviewedAt: new Date("2026-05-29T01:00:00.000Z")
    });

    assert.equal(result.outputPath, undefined);
    assert.equal(result.reviewedEvidence, 2);
    assert.equal(result.reviewRecords, 3);
    assert.equal(result.skippedEvidence, 3);
    assert.equal(result.decision, "needs_followup");
    assert.deepEqual(result.records.map((record) => `${record.evidence_id}:${record.requirement_id}`), [
      "ev_scan_cloudflare_cloudflare_waf:ISMS-P-2.10.2.cloudflare-config-export",
      "ev_scan_cloudflare_cloudflare_workers:ISMS-P-2.10.2.cloudflare-config-export",
      "ev_scan_cloudflare_cloudflare_workers:ISMS-P-2.10.2.cloud-change-approval"
    ]);
    assert.match(result.records[0]?.rationale ?? "", /operating evidence is still required/);
    assert.deepEqual(result.skipped.map((item) => item.evidence_id).sort(), [
      "ev_manual_policy",
      "ev_scan_cloudflare_unmapped",
      "ev_scan_github_branch_protection"
    ]);

    await assert.rejects(readFile(join(dir, "reviews", "evidence-review.jsonl"), "utf8"), /ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

Expected when run before implementation:
- TypeScript build fails because `reviewCloudflareEvidence` is not exported.

- [ ] **Step 4: Add append and validation test**

Add:

```ts
test("reviewCloudflareEvidence appends needs_followup records that satisfy public validation review warnings", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-review-cloudflare-append-"));
  try {
    await mkdir(join(dir, "evidence"), { recursive: true });
    await writeFile(join(dir, "evidence", "index.jsonl"), cloudflareEvidenceRows().slice(0, 2).map((row) => JSON.stringify(row)).join("\n") + "\n");

    const before = await validateEvidence(dir, { public: true });
    assert.match(before.warnings.join("\n"), /has candidate requirement mapping but no review decision/);

    const result = await reviewCloudflareEvidence(dir, {
      reviewer: "security-owner",
      reviewedAt: new Date("2026-05-29T01:00:00.000Z")
    });

    assert.equal(result.outputPath, join(dir, "reviews", "evidence-review.jsonl"));
    assert.equal(result.reviewedEvidence, 2);
    assert.equal(result.reviewRecords, 3);

    const rows = (await readFile(result.outputPath ?? "", "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(rows.map((row) => row.decision), ["needs_followup", "needs_followup", "needs_followup"]);
    assert.deepEqual(rows.map((row) => row.reviewed_at), [
      "2026-05-29T01:00:00.000Z",
      "2026-05-29T01:00:00.000Z",
      "2026-05-29T01:00:00.000Z"
    ]);

    const after = await validateEvidence(dir, { public: true });
    assert.equal(after.valid, true);
    assert.doesNotMatch(after.warnings.join("\n"), /has candidate requirement mapping but no review decision/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 5: Add decision guardrail tests**

Add:

```ts
test("reviewCloudflareEvidence rejects accepted decisions and requires rationale for rejected decisions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-review-cloudflare-guardrail-"));
  try {
    await mkdir(join(dir, "evidence"), { recursive: true });
    await writeFile(join(dir, "evidence", "index.jsonl"), cloudflareEvidenceRows().slice(0, 1).map((row) => JSON.stringify(row)).join("\n") + "\n");

    await assert.rejects(reviewCloudflareEvidence(dir, {
      decision: "accepted" as "needs_followup",
      rationale: "Owner accepted it."
    }), /Cloudflare bulk review cannot auto-accept scanner evidence/);

    await assert.rejects(reviewCloudflareEvidence(dir, {
      decision: "rejected",
      rationale: "   "
    }), /Cloudflare rejected bulk review requires --rationale/);

    const result = await reviewCloudflareEvidence(dir, {
      decision: "rejected",
      rationale: "This Cloudflare signal is not in the certification scope.",
      reviewedAt: new Date("2026-05-29T02:00:00.000Z")
    });

    assert.equal(result.reviewRecords, 1);
    assert.equal(result.records[0]?.decision, "rejected");
    assert.equal(result.records[0]?.rationale, "This Cloudflare signal is not in the certification scope.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 6: Run focused tests and confirm failure**

Run:

```bash
npm test -- --test-name-pattern=reviewCloudflareEvidence
```

Expected:
- FAIL before implementation because `reviewCloudflareEvidence` does not exist.

---

### Task 2: Implement `reviewCloudflareEvidence()`

**Files:**
- Modify: `src/commands/evidence.ts`

- [ ] **Step 1: Add public constants and interfaces**

Insert after `EvidenceReviewResult`:

```ts
export const DEFAULT_CLOUDFLARE_REVIEW_RATIONALE = "Cloudflare configuration was observed by a read-only connector, but operating evidence is still required before this requirement can be treated as satisfied.";

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

- [ ] **Step 2: Add the helper implementation**

Insert after `reviewEvidence()`:

```ts
export async function reviewCloudflareEvidence(
  workspaceRoot: string,
  options: CloudflareEvidenceReviewOptions = {}
): Promise<CloudflareEvidenceReviewResult> {
  const decision = options.decision ?? "needs_followup";
  if (decision === ("accepted" as "needs_followup" | "rejected")) {
    throw new Error("Cloudflare bulk review cannot auto-accept scanner evidence. Use evidence review <evidence-id> for a manual accepted decision.");
  }

  const rationale = options.rationale ?? DEFAULT_CLOUDFLARE_REVIEW_RATIONALE;
  if (decision === "rejected" && !rationale.trim()) {
    throw new Error("Cloudflare rejected bulk review requires --rationale.");
  }
  if (!rationale.trim()) {
    throw new Error("Cloudflare bulk review requires a non-empty rationale.");
  }

  const evidence = await loadEvidenceIndex(workspaceRoot);
  const records: EvidenceReviewRecord[] = [];
  const skipped: Array<{ evidence_id: string; reason: string }> = [];
  const reviewedEvidenceIds = new Set<string>();
  const reviewedAt = (options.reviewedAt ?? new Date()).toISOString();

  for (const item of evidence) {
    const skipReason = cloudflareReviewSkipReason(item);
    if (skipReason) {
      skipped.push({ evidence_id: item.evidence_id, reason: skipReason });
      continue;
    }

    reviewedEvidenceIds.add(item.evidence_id);
    for (const requirementId of item.supports) {
      records.push({
        schemaVersion: 1,
        reviewed_at: reviewedAt,
        evidence_id: item.evidence_id,
        requirement_id: requirementId,
        decision,
        ...(options.reviewer ? { reviewer: options.reviewer } : {}),
        rationale: rationale.trim()
      });
    }
  }

  const outputPath = join(workspaceRoot, "reviews", "evidence-review.jsonl");
  if (!options.dryRun && records.length > 0) {
    await mkdir(join(workspaceRoot, "reviews"), { recursive: true });
    await appendFile(outputPath, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
  }

  return {
    ...(options.dryRun || records.length === 0 ? {} : { outputPath }),
    reviewedEvidence: reviewedEvidenceIds.size,
    reviewRecords: records.length,
    skippedEvidence: skipped.length,
    decision,
    records,
    skipped
  };
}
```

- [ ] **Step 3: Add eligibility helper**

Insert near other private helper functions:

```ts
function cloudflareReviewSkipReason(item: EvidenceItem): string | undefined {
  if (item.metadata.signal_source !== "cloudflare") {
    return "not Cloudflare scanner evidence";
  }
  if (item.origin !== "scan") {
    return "not scan-origin evidence";
  }
  if (item.lifecycle_status !== "candidate") {
    return "not candidate evidence";
  }
  if (item.classification !== "confidential" && item.classification !== "internal") {
    return "classification is not eligible for Cloudflare bulk review";
  }
  if (item.supports.length === 0) {
    return "no requirement mapping";
  }
  return undefined;
}
```

- [ ] **Step 4: Run focused helper tests**

Run:

```bash
npm test -- --test-name-pattern=reviewCloudflareEvidence
```

Expected:
- PASS for the new helper tests.

- [ ] **Step 5: Commit the helper**

Run:

```bash
git add src/commands/evidence.ts test/commands/evidence.test.ts
git commit -m "feat: add Cloudflare evidence bulk review helper"
```

Expected:
- Commit succeeds with only helper and helper-test changes.

---

### Task 3: Add CLI Parser and Command Tests

**Files:**
- Modify: `src/cli.ts`
- Modify: `test/commands/evidence.test.ts`

- [ ] **Step 1: Import the helper in CLI**

Change the evidence import in `src/cli.ts`:

```ts
import { exportPublicEvidence, indexEvidenceFromScan, reviewCloudflareEvidence, reviewEvidence, validateEvidence } from "./commands/evidence.js";
```

- [ ] **Step 2: Add the CLI branch**

Insert before the generic `evidence review` branch:

```ts
  if (command === "evidence" && args[0] === "review-cloudflare") {
    const parsed = parseCloudflareEvidenceReviewArgs(args.slice(1));
    if (parsed) {
      const result = await reviewCloudflareEvidence(process.cwd(), parsed);
      console.log(JSON.stringify(result, null, 2));
      return;
    }
  }
```

- [ ] **Step 3: Add argument parser**

Insert after `parseEvidenceReviewArgs()`:

```ts
function parseCloudflareEvidenceReviewArgs(args: string[]): {
  decision?: "needs_followup" | "rejected";
  rationale?: string;
  reviewer?: string;
  dryRun?: boolean;
} | undefined {
  let decision: "needs_followup" | "rejected" | undefined;
  let rationale: string | undefined;
  let reviewer: string | undefined;
  let dryRun = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      return undefined;
    }

    if (arg === "--decision") {
      if (value === "accepted") {
        throw new Error("Cloudflare bulk review cannot auto-accept scanner evidence. Use evidence review <evidence-id> for a manual accepted decision.");
      }
      if (value !== "needs_followup" && value !== "rejected") {
        return undefined;
      }
      decision = value;
    } else if (arg === "--rationale") {
      rationale = value;
    } else if (arg === "--reviewer") {
      reviewer = value;
    } else {
      return undefined;
    }
    index += 1;
  }

  return {
    ...(decision ? { decision } : {}),
    ...(rationale ? { rationale } : {}),
    ...(reviewer ? { reviewer } : {}),
    ...(dryRun ? { dryRun } : {})
  };
}
```

- [ ] **Step 4: Add usage line**

Add this usage line next to the existing evidence review usage:

```ts
  console.error("Usage: isms-agent evidence review-cloudflare [--decision needs_followup|rejected] [--rationale <text>] [--reviewer <name>] [--dry-run]");
```

- [ ] **Step 5: Add CLI happy-path test**

Append to `test/commands/evidence.test.ts` near existing CLI evidence tests:

```ts
test("CLI supports evidence review-cloudflare dry run and append flow", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-cli-review-cloudflare-"));
  try {
    await mkdir(join(dir, "evidence"), { recursive: true });
    await writeFile(join(dir, "evidence", "index.jsonl"), cloudflareEvidenceRows().slice(0, 2).map((row) => JSON.stringify(row)).join("\n") + "\n");

    const dryRun = spawnSync(process.execPath, [
      join(process.cwd(), "dist", "cli.js"),
      "evidence",
      "review-cloudflare",
      "--dry-run",
      "--reviewer",
      "security-owner"
    ], {
      cwd: dir,
      encoding: "utf8"
    });
    assert.equal(dryRun.status, 0, dryRun.stderr);
    const dryRunParsed = JSON.parse(dryRun.stdout);
    assert.equal(dryRunParsed.reviewRecords, 3);
    assert.equal(dryRunParsed.outputPath, undefined);

    const append = spawnSync(process.execPath, [
      join(process.cwd(), "dist", "cli.js"),
      "evidence",
      "review-cloudflare",
      "--decision",
      "needs_followup",
      "--reviewer",
      "security-owner"
    ], {
      cwd: dir,
      encoding: "utf8"
    });
    assert.equal(append.status, 0, append.stderr);
    const appended = JSON.parse(append.stdout);
    assert.equal(appended.reviewRecords, 3);
    assert.equal(appended.outputPath, join(dir, "reviews", "evidence-review.jsonl"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 6: Add CLI accepted rejection test**

Append:

```ts
test("CLI rejects evidence review-cloudflare accepted decision", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-cli-review-cloudflare-accepted-"));
  try {
    const result = spawnSync(process.execPath, [
      join(process.cwd(), "dist", "cli.js"),
      "evidence",
      "review-cloudflare",
      "--decision",
      "accepted"
    ], {
      cwd: dir,
      encoding: "utf8"
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Cloudflare bulk review cannot auto-accept scanner evidence/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 7: Run CLI-focused tests**

Run:

```bash
npm test -- --test-name-pattern="CLI supports evidence review-cloudflare|CLI rejects evidence review-cloudflare"
```

Expected:
- PASS.

- [ ] **Step 8: Commit the CLI**

Run:

```bash
git add src/cli.ts test/commands/evidence.test.ts
git commit -m "feat: add Cloudflare evidence review CLI"
```

Expected:
- Commit succeeds with CLI and CLI-test changes.

---

### Task 4: Add Public Report Regression Coverage

**Files:**
- Modify: `test/commands/evidence.test.ts`
- Read: `src/commands/report.ts`

- [ ] **Step 1: Search for existing report tests**

Run:

```bash
rg -n "generateReports|public report|public-control-gap-report|public-evidence-map" test src
```

Expected:
- Current repository has no focused report test file, so add one small regression to `test/commands/evidence.test.ts` to avoid broad restructuring.

- [ ] **Step 2: Add a public-rationale omission regression**

Use this test if adding to `test/commands/evidence.test.ts`:

```ts
test("public evidence validation and exports do not expose Cloudflare review rationale", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-cloudflare-public-rationale-"));
  try {
    await mkdir(join(dir, "evidence"), { recursive: true });
    await writeFile(join(dir, "evidence", "index.jsonl"), cloudflareEvidenceRows().slice(0, 1).map((row) => JSON.stringify(row)).join("\n") + "\n");

    const privateRationale = "Private review detail for internal audit follow-up.";
    await reviewCloudflareEvidence(dir, {
      rationale: privateRationale,
      reviewer: "security-owner",
      reviewedAt: new Date("2026-05-29T03:00:00.000Z")
    });

    const validation = await validateEvidence(dir, { public: true });
    assert.equal(validation.valid, true);
    assert.doesNotMatch(JSON.stringify(validation), new RegExp(privateRationale));

    const exported = await exportPublicEvidence(dir);
    assert.equal(exported.exportedEvidence, 0);
    const content = await readFile(exported.outputPath, "utf8");
    assert.equal(content, "");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run focused public-safety test**

Run:

```bash
npm test -- --test-name-pattern="public evidence validation and exports do not expose Cloudflare review rationale"
```

Expected:
- PASS.

- [ ] **Step 4: Commit public safety regression**

Run:

```bash
git add test/commands/evidence.test.ts
git commit -m "test: cover Cloudflare review public safety"
```

Expected:
- Commit succeeds.

---

### Task 5: Update README and Security Model

**Files:**
- Modify: `README.md`
- Modify: `docs/security-model.md`

- [ ] **Step 1: Update README command examples**

Find the Cloudflare evidence review section in `README.md` and make the command example use:

```bash
isms-agent evidence review-cloudflare \
  --decision needs_followup \
  --reviewer security-owner
isms-agent evidence validate --public
```

Add this explanation near the command:

```markdown
`review-cloudflare` is a bulk overlay for Cloudflare scanner output. It marks configuration snapshots as `needs_followup` by default and writes one private review record per supported requirement. It cannot create `accepted` decisions; use `isms-agent evidence review <evidence-id>` only after a human owner confirms operating evidence such as an access review, change approval, or dated cloud security review.
```

- [ ] **Step 2: Update security model**

Add this paragraph after the existing scanner-output review paragraph in `docs/security-model.md`:

```markdown
`isms-agent evidence review-cloudflare` is a local-only bulk review overlay for Cloudflare scanner evidence. It reads `evidence/index.jsonl`, writes append-only records to `reviews/evidence-review.jsonl`, and does not call Cloudflare APIs. Bulk Cloudflare review may write `needs_followup` or explicit `rejected` decisions, but it must not write `accepted`; accepted decisions require a separate manual review of operating evidence.
```

- [ ] **Step 3: Run doc diff check**

Run:

```bash
git diff --check
```

Expected:
- No trailing whitespace or patch-format issues.

- [ ] **Step 4: Commit docs**

Run:

```bash
git add README.md docs/security-model.md
git commit -m "docs: document Cloudflare review overlay"
```

Expected:
- Commit succeeds.

---

### Task 6: Full Verification

**Files:**
- Read: `package.json`
- Execute built CLI after `npm test` has rebuilt `dist/`.

- [ ] **Step 1: Run full tests**

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

- [ ] **Step 3: Validate control pack**

Run:

```bash
node dist/cli.js pack validate
```

Expected:
- JSON output contains `"valid": true`.

- [ ] **Step 4: Validate public evidence safety**

Run:

```bash
node dist/cli.js evidence validate --public
```

Expected:
- JSON output contains `"valid": true`.
- Cloudflare candidate evidence should no longer produce no-review warnings after `review-cloudflare` has been run in the local workspace.

- [ ] **Step 5: Run patch hygiene check**

Run:

```bash
git diff --check
```

Expected:
- No output and exit code 0.

- [ ] **Step 6: Inspect final diff**

Run:

```bash
git diff --stat master...HEAD
git diff -- src/commands/evidence.ts src/cli.ts test/commands/evidence.test.ts README.md docs/security-model.md
```

Expected:
- Diff only touches the planned files.
- No token values, account IDs, zone IDs, hostnames, DNS values, R2 bucket names, Worker script names, Hyperdrive names, or private review rationale from the real service appear in tracked files.

---

## Acceptance Checklist

- [ ] `isms-agent evidence review-cloudflare --dry-run` previews eligible Cloudflare evidence without writing `reviews/evidence-review.jsonl`.
- [ ] `isms-agent evidence review-cloudflare --decision needs_followup --reviewer <name>` appends one review record per supported requirement.
- [ ] `isms-agent evidence review-cloudflare --decision accepted` fails with the SPEC guardrail message.
- [ ] `isms-agent evidence review-cloudflare --decision rejected` requires explicit non-empty rationale.
- [ ] Non-Cloudflare, non-scan, non-candidate, unsafe-classification, and unmapped evidence are skipped with reasons.
- [ ] `evidence validate --public` no longer warns that reviewed Cloudflare candidate requirements lack review decisions.
- [ ] Public validation and exports do not expose private review rationale.
- [ ] `report --public` remains conservative: scanner evidence plus `needs_followup` does not make `ISMS-P-2.10.2` satisfied.
- [ ] `npm test` passes.
- [ ] `npm run check` passes.
- [ ] `node dist/cli.js pack validate` passes.
- [ ] `node dist/cli.js evidence validate --public` passes.
- [ ] `git diff --check` passes.

## Implementation Handoff

Use `superpowers:subagent-driven-development` for implementation. Dispatch one fresh subagent per task group:

1. Helper and unit tests.
2. CLI parser and CLI tests.
3. Public-safety regression and docs.
4. Final verification and review.

Each subagent should return changed files, tests run, and any deviations from this plan. The reviewing agent should reject any implementation that calls Cloudflare APIs, writes accepted bulk decisions, mutates scan files, or exposes review rationale in public artifacts.
