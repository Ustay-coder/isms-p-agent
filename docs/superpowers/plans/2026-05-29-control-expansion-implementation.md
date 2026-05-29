# Control Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ISMS-P control expansion repeatable from OpenKB while preserving the evidence-safety model proven by the Cloudflare review overlay dogfood.

**Architecture:** Do not expand controls by hand-copying JSON into runtime workspaces. First add a `pack install` path so reports can run from curated packs, then harden Cloudflare review reruns, add accepted operating evidence templates, and only then expand OpenKB controls in reviewable batches. Public repository contents remain packs, schemas, validators, redacted samples, and docs; real evidence and review overlays remain ignored local workspace state.

**Tech Stack:** Node.js, TypeScript, node:test, JSONL, local filesystem CLI, OpenKB-derived control packs.

---

## Current Findings from Dogfood

- PR #9 merged the Cloudflare review overlay into `master`.
- `node dist/cli.js evidence review-cloudflare --dry-run` against the evaluation service evidence returned 9 Cloudflare evidence items and 13 requirement review records.
- `node dist/cli.js evidence review-cloudflare --decision needs_followup --reviewer security-owner` wrote review overlay records to ignored `reviews/evidence-review.jsonl`.
- `node dist/cli.js evidence validate --public` passed with `valid: true`, 9 checked evidence, no issues, no warnings.
- `node dist/cli.js report --public` failed because the current workspace has no `controls/` directory. The curated controls exist under `packs/isms-p-core-v0/controls`, but report generation currently loads only workspace-local `controls/*.json`.
- Re-running `review-cloudflare` appends another `needs_followup` record for the same evidence/requirement pairs. This is append-only and valid, but noisy for repeated dogfood runs.

## Implementation Order

1. Add `isms-agent pack install` so a workspace can install pack controls into `controls/` without shell-copy steps.
2. Make `review-cloudflare` idempotent for unchanged latest non-accepted decisions while preserving append-only history for explicit state changes.
3. Add an accepted operating evidence workflow that requires private/manual evidence before `accepted`.
4. Re-run the evaluation service dogfood end-to-end: install pack, review Cloudflare evidence, validate public safety, generate public reports.
5. Expand controls from OpenKB in small batches with source-of-truth checks and validator gates.

---

### Task 1: Add Pack Install Command

**Files:**
- Modify: `src/commands/pack.ts`
- Modify: `src/cli.ts`
- Test: `test/commands/pack.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Write the failing pack install test**

Add this test to `test/commands/pack.test.ts`:

```ts
test("installPack copies validated pack controls into a workspace without overwriting by default", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-pack-install-"));
  try {
    const packRoot = join(process.cwd(), "packs", "isms-p-core-v0");
    const result = await installPack(dir, {
      packRoot,
      overwrite: false
    });

    assert.equal(result.installedControls, 3);
    assert.deepEqual(result.skippedControls, []);
    assert.equal(result.outputDir, join(dir, "controls"));

    const installed = JSON.parse(await readFile(join(dir, "controls", "ISMS-P-2.10.2.json"), "utf8"));
    assert.equal(installed.control_id, "ISMS-P-2.10.2");

    await writeFile(join(dir, "controls", "ISMS-P-2.10.2.json"), "{\"local\":true}\n");
    const second = await installPack(dir, { packRoot, overwrite: false });
    assert.equal(second.installedControls, 2);
    assert.deepEqual(second.skippedControls, ["ISMS-P-2.10.2.json"]);

    const preserved = await readFile(join(dir, "controls", "ISMS-P-2.10.2.json"), "utf8");
    assert.equal(preserved, "{\"local\":true}\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

Expected imports:

```ts
import { installPack, validatePack } from "../../src/commands/pack.js";
```

- [ ] **Step 2: Run the targeted failing test**

Run:

```bash
npm run build
node --test dist/test/commands/pack.test.js
```

Expected: FAIL because `installPack` is not exported.

- [ ] **Step 3: Implement `installPack`**

Add to `src/commands/pack.ts`:

```ts
import { copyFile, mkdir } from "node:fs/promises";

export interface PackInstallOptions {
  packRoot: string;
  overwrite?: boolean;
}

export interface PackInstallResult {
  packRoot: string;
  outputDir: string;
  installedControls: number;
  skippedControls: string[];
}

export async function installPack(workspaceRoot: string, options: PackInstallOptions): Promise<PackInstallResult> {
  const packRoot = resolve(process.cwd(), options.packRoot);
  const validation = await validatePack(packRoot);
  if (!validation.valid) {
    throw new Error(`Pack is invalid and cannot be installed: ${validation.issues.join("; ")}`);
  }

  const controlsRoot = join(packRoot, "controls");
  const outputDir = join(workspaceRoot, "controls");
  await mkdir(outputDir, { recursive: true });

  const skippedControls: string[] = [];
  let installedControls = 0;
  for (const name of await jsonControlFileNames(controlsRoot)) {
    const destination = join(outputDir, name);
    try {
      await copyFile(join(controlsRoot, name), destination, options.overwrite ? 0 : constants.COPYFILE_EXCL);
      installedControls += 1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        skippedControls.push(name);
        continue;
      }
      throw error;
    }
  }

  return { packRoot, outputDir, installedControls, skippedControls };
}
```

Also add these imports:

```ts
import { constants } from "node:fs";
import { copyFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
```

Add helper near existing pack helpers:

```ts
async function jsonControlFileNames(directory: string): Promise<string[]> {
  return (await readdir(directory))
    .filter((name) => name.endsWith(".json"))
    .sort((left, right) => left.localeCompare(right, "en"));
}
```

- [ ] **Step 4: Add CLI route**

Modify `src/cli.ts` imports:

```ts
import { generatePack, installPack, parsePackGenerateArgs, validatePack } from "./commands/pack.js";
```

Add before `pack validate`:

```ts
if (command === "pack" && args[0] === "install") {
  const parsed = parsePackInstallArgs(args.slice(1));
  if (parsed) {
    const result = await installPack(process.cwd(), parsed);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
}
```

Add parser:

```ts
function parsePackInstallArgs(args: string[]): { packRoot: string; overwrite?: boolean } | undefined {
  if (args.length === 0) {
    return { packRoot: "packs/isms-p-core-v0" };
  }
  if (args.length === 1 && args[0] === "--overwrite") {
    return { packRoot: "packs/isms-p-core-v0", overwrite: true };
  }
  if (args.length === 1 && args[0] && !args[0].startsWith("--")) {
    return { packRoot: args[0] };
  }
  if (args.length === 2 && args[0] && !args[0].startsWith("--") && args[1] === "--overwrite") {
    return { packRoot: args[0], overwrite: true };
  }
  return undefined;
}
```

Add usage:

```ts
console.error("Usage: isms-agent pack install [pack-dir] [--overwrite]");
```

- [ ] **Step 5: Add CLI test**

Add to `test/commands/pack.test.ts`:

```ts
test("CLI installs the default pack into controls", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-pack-install-cli-"));
  try {
    const result = spawnSync(process.execPath, [
      join(process.cwd(), "dist", "cli.js"),
      "pack",
      "install",
      join(process.cwd(), "packs", "isms-p-core-v0")
    ], {
      cwd: dir,
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.installedControls, 3);
    assert.equal(await readdir(join(dir, "controls")).then((names) => names.filter((name) => name.endsWith(".json")).length), 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

Expected imports:

```ts
import { spawnSync } from "node:child_process";
```

- [ ] **Step 6: Verify Task 1**

Run:

```bash
npm test
npm run check
node dist/cli.js pack install --overwrite
node dist/cli.js report --public
node dist/cli.js evidence validate --public
```

Expected:
- Tests pass.
- `controls/` is populated locally.
- `report --public` writes three public Markdown report files under ignored `reports/`.
- `evidence validate --public` still passes.

- [ ] **Step 7: Commit Task 1**

```bash
git add src/commands/pack.ts src/cli.ts test/commands/pack.test.ts README.md
git commit -m "feat: install control packs into workspaces"
```

---

### Task 2: Make Cloudflare Bulk Review Reruns Idempotent

**Files:**
- Modify: `src/commands/evidence.ts`
- Test: `test/commands/evidence.test.ts`
- Modify: `docs/superpowers/specs/2026-05-29-cloudflare-review-overlay-design.md`

- [ ] **Step 1: Write failing idempotency test**

Add to `test/commands/evidence.test.ts`:

```ts
test("reviewCloudflareEvidence skips unchanged latest bulk review decisions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-review-cloudflare-idempotent-"));
  try {
    await mkdir(join(dir, "evidence"), { recursive: true });
    await writeFile(join(dir, "evidence", "index.jsonl"), cloudflareEvidenceRows().slice(0, 2).map((row) => JSON.stringify(row)).join("\n") + "\n");

    const first = await reviewCloudflareEvidence(dir, {
      reviewer: "security-owner",
      reviewedAt: new Date("2026-05-29T01:00:00.000Z")
    });
    assert.equal(first.reviewRecords, 3);

    const second = await reviewCloudflareEvidence(dir, {
      reviewer: "security-owner",
      reviewedAt: new Date("2026-05-29T02:00:00.000Z")
    });
    assert.equal(second.reviewRecords, 0);
    assert.equal(second.skippedEvidence, 3);
    assert.match(second.skipped.map((item) => item.reason).join("\n"), /latest review already needs_followup/);

    const content = await readFile(join(dir, "reviews", "evidence-review.jsonl"), "utf8");
    assert.equal(content.trim().split("\n").length, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run targeted failing test**

Run:

```bash
npm run build
node --test dist/test/commands/evidence.test.js --test-name-pattern "reviewCloudflareEvidence skips unchanged"
```

Expected: FAIL because reruns append duplicate `needs_followup` records.

- [ ] **Step 3: Implement latest-decision skip map**

In `src/commands/evidence.ts`, replace `latestAcceptedReviewKeys` with a general latest review map:

```ts
async function latestReviewByKey(workspaceRoot: string): Promise<Map<string, EvidenceReviewRecord>> {
  const latestByKey = new Map<string, EvidenceReviewRecord>();
  for (const review of await loadEvidenceReviews(workspaceRoot)) {
    const key = `${review.evidence_id}\0${review.requirement_id}`;
    const current = latestByKey.get(key);
    if (!current || Date.parse(current.reviewed_at) <= Date.parse(review.reviewed_at)) {
      latestByKey.set(key, review);
    }
  }
  return latestByKey;
}
```

In `reviewCloudflareEvidence`, replace accepted-only logic:

```ts
const latestReviews = await latestReviewByKey(workspaceRoot);
```

Inside the requirement loop:

```ts
const latestReview = latestReviews.get(reviewKey);
if (latestReview?.decision === "accepted") {
  skipped.push({
    evidence_id: item.evidence_id,
    reason: `existing accepted review decision for ${requirementId}`
  });
  continue;
}
if (latestReview?.decision === decision && latestReview.rationale.trim() === rationale.trim()) {
  skipped.push({
    evidence_id: item.evidence_id,
    reason: `latest review already ${decision} for ${requirementId}`
  });
  continue;
}
```

- [ ] **Step 4: Verify Task 2**

Run:

```bash
npm test
npm run check
node dist/cli.js evidence review-cloudflare --dry-run
node dist/cli.js evidence validate --public
```

Expected:
- Repeated dry-runs show skipped records when the latest local review already has the same decision and rationale.
- Public validation remains clean.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/commands/evidence.ts test/commands/evidence.test.ts docs/superpowers/specs/2026-05-29-cloudflare-review-overlay-design.md
git commit -m "fix: avoid duplicate cloudflare review overlays"
```

---

### Task 3: Add Accepted Operating Evidence Templates

**Files:**
- Create: `docs/evidence-templates/cloudflare/ISMS-P-2.10.2-cloud-admin-access-review.md`
- Create: `docs/evidence-templates/cloudflare/ISMS-P-2.10.2-cloud-change-approval.md`
- Create: `docs/evidence-templates/cloudflare/ISMS-P-2.10.2-cloud-security-review.md`
- Modify: `README.md`
- Test: `test/docs/evidence-templates.test.ts`

- [ ] **Step 1: Write template coverage test**

Create `test/docs/evidence-templates.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const TEMPLATE_ROOT = join(process.cwd(), "docs", "evidence-templates", "cloudflare");

test("Cloudflare evidence templates describe accepted evidence without private examples", async () => {
  const files = [
    "ISMS-P-2.10.2-cloud-admin-access-review.md",
    "ISMS-P-2.10.2-cloud-change-approval.md",
    "ISMS-P-2.10.2-cloud-security-review.md"
  ];

  for (const file of files) {
    const content = await readFile(join(TEMPLATE_ROOT, file), "utf8");
    assert.match(content, /Accepted evidence criteria/);
    assert.match(content, /Public export rule/);
    assert.match(content, /Review command/);
    assert.doesNotMatch(content, /cfat_|api[_-]?key|secret|\/Users\//i);
  }
});
```

- [ ] **Step 2: Create admin access review template**

Create `docs/evidence-templates/cloudflare/ISMS-P-2.10.2-cloud-admin-access-review.md`:

```md
# ISMS-P-2.10.2 Cloud Admin Access Review

## Requirement

Cloud administrators and privileged Cloudflare Access application owners are reviewed by an accountable owner on a defined schedule.

## Accepted evidence criteria

- Dated access review record exists.
- Reviewer is identified by role or team, not by a private personal account in public output.
- The reviewed scope includes Cloudflare account admins, Access applications, and emergency access paths.
- Exceptions have an owner and follow-up date.
- Evidence has `valid_until` no later than the next review cycle.

## Private storage

Store the real record under `evidence/private/ISMS-P-2.10.2/access-review/`.

## Public export rule

Do not publish member names, email addresses, account IDs, application IDs, or raw Cloudflare exports. Public reports may include only the evidence ID, requirement ID, decision, classification, and freshness status.

## Review command

```bash
isms-agent evidence review ev_cloudflare_admin_access_review_YYYY_MM \
  --requirement ISMS-P-2.10.2.cloud-admin-access-review \
  --decision accepted \
  --rationale "Security owner confirmed the dated admin access review record." \
  --reviewer security-owner \
  --expires-at YYYY-MM-DDT00:00:00.000Z
```
```

- [ ] **Step 3: Create change approval template**

Create `docs/evidence-templates/cloudflare/ISMS-P-2.10.2-cloud-change-approval.md`:

```md
# ISMS-P-2.10.2 Cloud Change Approval

## Requirement

Cloudflare configuration changes are approved, traceable to a requester, and reviewed after deployment when the change affects security controls or production traffic.

## Accepted evidence criteria

- Change record links the request, approval, implementation date, and rollback note.
- The scope covers Workers, R2, Hyperdrive, API Gateway, DNS, WAF, TLS, or Access changes when they are in use.
- Emergency changes include after-the-fact approval.
- Evidence is tied to a deployment or configuration-change event, not only to a scanner snapshot.

## Private storage

Store the real record under `evidence/private/ISMS-P-2.10.2/change-approval/`.

## Public export rule

Do not publish PR bodies containing private endpoints, DNS records, bucket names, account IDs, or customer data. Public reports may state that accepted change-approval evidence exists and whether it is current.

## Review command

```bash
isms-agent evidence review ev_cloudflare_change_approval_YYYY_MM_DD \
  --requirement ISMS-P-2.10.2.cloud-change-approval \
  --decision accepted \
  --rationale "Security owner confirmed approval and rollback context for the Cloudflare change." \
  --reviewer security-owner
```
```

- [ ] **Step 4: Create cloud security review template**

Create `docs/evidence-templates/cloudflare/ISMS-P-2.10.2-cloud-security-review.md`:

```md
# ISMS-P-2.10.2 Cloud Security Review

## Requirement

Cloud security posture is reviewed on a defined cycle using read-only connector outputs plus human-confirmed operating evidence.

## Accepted evidence criteria

- Review record lists in-scope Cloudflare products.
- Read-only scan output is referenced only as candidate configuration evidence.
- The reviewer confirms unresolved `needs_followup` items, accepted compensating evidence, or rejected out-of-scope findings.
- Follow-up actions are tracked with owners and due dates.

## Private storage

Store the real record under `evidence/private/ISMS-P-2.10.2/security-review/`.

## Public export rule

Do not publish raw scans, account IDs, zone IDs, DNS record values, bucket names, worker names, or review rationale. Public reports may show requirement status and redacted evidence IDs only.

## Review command

```bash
isms-agent evidence review ev_cloudflare_security_review_YYYY_QN \
  --requirement ISMS-P-2.10.2.cloudflare-config-export \
  --decision accepted \
  --rationale "Security owner confirmed the dated Cloudflare security review record." \
  --reviewer security-owner \
  --expires-at YYYY-MM-DDT00:00:00.000Z
```
```

- [ ] **Step 5: Verify Task 3**

Run:

```bash
npm test
npm run check
node dist/cli.js evidence validate --public
```

Expected: tests pass and public validation remains clean.

- [ ] **Step 6: Commit Task 3**

```bash
git add docs/evidence-templates/cloudflare test/docs/evidence-templates.test.ts README.md
git commit -m "docs: add cloudflare operating evidence templates"
```

---

### Task 4: Dogfood End-to-End Reports on Evaluation Service

**Files:**
- Modify: `docs/connectors/cloudflare.md`
- Modify: `docs/security-model.md`
- Generated but ignored: `controls/`, `reviews/`, `reports/`

- [ ] **Step 1: Install the current pack locally**

Run:

```bash
node dist/cli.js pack install packs/isms-p-core-v0 --overwrite
```

Expected:

```json
{
  "installedControls": 3,
  "skippedControls": []
}
```

- [ ] **Step 2: Re-run review overlay dry-run**

Run:

```bash
node dist/cli.js evidence review-cloudflare --dry-run
```

Expected:
- Existing unchanged review records are skipped after Task 2.
- New or changed Cloudflare evidence remains visible in preview.

- [ ] **Step 3: Apply review overlay if needed**

Run only when dry-run shows new records:

```bash
node dist/cli.js evidence review-cloudflare --decision needs_followup --reviewer security-owner
```

Expected: only new or changed review pairs are appended.

- [ ] **Step 4: Validate and generate public reports**

Run:

```bash
node dist/cli.js evidence validate --public
node dist/cli.js report --public
```

Expected:
- Public validation passes.
- `reports/public-backlog.md`, `reports/public-control-gap-report.md`, and `reports/public-evidence-map.md` are generated.
- Report contents do not include `reviews/`, `scans/`, `evidence/private/`, account IDs, tokens, or private review rationale.

- [ ] **Step 5: Record dogfood notes**

Update `docs/connectors/cloudflare.md` with:

```md
## Evaluation Service Dogfood Notes

- `pack install` is required before report generation because reports use workspace-local `controls/*.json`.
- Cloudflare scanner evidence is treated as `needs_followup` until operating evidence is accepted through a manual review command.
- Public reports must be generated only after `evidence validate --public` passes.
```

- [ ] **Step 6: Commit Task 4**

```bash
git add docs/connectors/cloudflare.md docs/security-model.md
git commit -m "docs: record evaluation service report dogfood"
```

---

### Task 5: Expand OpenKB Controls in Reviewable Batches

**Files:**
- Modify or regenerate: `packs/isms-p-core-v0/pack.json`
- Add: `packs/isms-p-core-v0/controls/*.json`
- Modify: `packs/isms-p-core-v0/sources/source-manifest.json`
- Modify: `test/packs/isms-p-core-v0.test.ts`
- Optional generated draft: `packs/isms-p-core-v1/`

- [ ] **Step 1: Choose the first expansion batch**

Use controls that improve evidence automation without exploding scope:

```text
ISMS-P-2.1.1 정책의 유지관리
ISMS-P-2.3.1 외부자 현황 관리
ISMS-P-2.4.2 보안 교육
ISMS-P-2.9.4 로그 및 접속기록 관리
ISMS-P-2.10.1 보안시스템 운영
```

Rationale:
- 2.1.1 anchors policy lifecycle evidence.
- 2.3.1 connects to vendor/SaaS inventory evidence.
- 2.4.2 creates recurring education/training evidence.
- 2.9.4 connects to log retention and Cloudflare/CI/CD observability evidence.
- 2.10.1 pairs naturally with 2.10.2 for security control operation.

- [ ] **Step 2: Generate a draft pack from OpenKB**

Run with the real OpenKB root:

```bash
node dist/cli.js pack generate \
  --openkb /Users/jeean/Documents/obsidian-vault/evaluate.club/09_보안_ISMS-P_openkb \
  --pack packs/isms-p-core-v1 \
  --controls ISMS-P-2.1.1,ISMS-P-2.3.1,ISMS-P-2.4.2,ISMS-P-2.9.4,ISMS-P-2.10.1 \
  --version 0.2.0
```

Expected:
- Generated controls have `pack.source_of_truth: "openkb"`.
- Generated controls have `pack.review_status: "needs_human_review"`.
- Direct `source_refs` use `compiled/` or `wiki/`, not `raw/legal/`.

- [ ] **Step 3: Validate generated pack**

Run:

```bash
node dist/cli.js pack validate packs/isms-p-core-v1
```

Expected: `valid: true`.

- [ ] **Step 4: Curate requirement-level evidence mappings**

For each new control, ensure every generated control has at least:

```json
{
  "requirements": [
    {
      "requirement_id": "ISMS-P-2.9.4.log-retention-policy",
      "control_id": "ISMS-P-2.9.4",
      "title": "Log retention policy and scope are defined",
      "kind": "policy",
      "required": true,
      "evidence_types": ["policy_document", "configuration_export"],
      "review_frequency": "annual",
      "freshness_days": 365,
      "source_refs": []
    }
  ]
}
```

The exact requirement IDs must be stable and lower-case suffixes must describe evidence, not implementation guesses.

- [ ] **Step 5: Add pack quality tests**

Modify `test/packs/isms-p-core-v0.test.ts` so the expected control list includes the new batch after curation:

```ts
const EXPECTED_CONTROLS = [
  "ISMS-P-2.1.1",
  "ISMS-P-2.3.1",
  "ISMS-P-2.4.2",
  "ISMS-P-2.5.3",
  "ISMS-P-2.5.6",
  "ISMS-P-2.9.4",
  "ISMS-P-2.10.1",
  "ISMS-P-2.10.2"
];
```

Add a requirement-quality assertion:

```ts
test("active pack controls have requirement-level evidence mappings", async () => {
  const controls = await loadPackControls();
  for (const control of controls.filter((item) => item.pack?.effective_status === "active")) {
    assert.ok((control.requirements?.length ?? 0) >= 2, `${control.control_id} should have at least two evidence requirements`);
    for (const requirement of control.requirements ?? []) {
      assert.equal(requirement.control_id, control.control_id);
      assert.match(requirement.requirement_id, new RegExp(`^${control.control_id}\\.`));
      assert.ok(requirement.evidence_types.length > 0, `${requirement.requirement_id} must list evidence_types`);
      assert.ok(requirement.source_refs.length > 0, `${requirement.requirement_id} must cite source_refs`);
    }
  }
});
```

- [ ] **Step 6: Verify Task 5**

Run:

```bash
npm test
npm run check
node dist/cli.js pack validate packs/isms-p-core-v0
node dist/cli.js pack install packs/isms-p-core-v0 --overwrite
node dist/cli.js report --public
node dist/cli.js evidence validate --public
```

Expected:
- Pack validates.
- Reports generate after install.
- New controls without evidence appear as missing or needs confirmation, not satisfied.
- Public validation remains clean.

- [ ] **Step 7: Commit Task 5**

```bash
git add packs/isms-p-core-v0 test/packs/isms-p-core-v0.test.ts
git commit -m "feat: expand core control pack"
```

---

## PR and Merge Gate

Before opening the implementation PR:

```bash
npm test
npm run check
git diff --check
node dist/cli.js pack validate packs/isms-p-core-v0
node dist/cli.js pack install packs/isms-p-core-v0 --overwrite
node dist/cli.js evidence validate --public
node dist/cli.js report --public
```

The PR must state:

- Scanner evidence is still candidate evidence.
- Accepted evidence requires manual operating evidence review.
- Public outputs redact private paths, review rationale, raw scans, and real evidence files.
- Expanded controls come from OpenKB as Source of Truth.
- `pack install` is required before reports in a fresh workspace.

## Follow-Up Priority After This Plan

1. Build Task 1 and Task 2 first because they unblock reliable dogfood.
2. Build Task 3 to make accepted evidence operationally usable.
3. Run Task 4 before expanding controls so the current evaluation service remains the integration test.
4. Build Task 5 in one small OpenKB batch, then repeat with the next batch only after review.
