# Small-Batch Control Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the small-batch OpenKB control expansion path without weakening the evidence-safety model.

**Architecture:** First make curated packs installable into a workspace so report generation does not require manual copying. Then make Cloudflare bulk review idempotent, document the private/manual accepted-evidence path, and expand the core pack with the first five OpenKB controls under requirement-level quality gates.

**Tech Stack:** Node.js 22, TypeScript, node:test, JSON/JSONL, local filesystem CLI, OpenKB-derived control packs.

---

## File Structure

- `src/commands/pack.ts`: owns pack validation, OpenKB generation entrypoint, and the new pack-install function.
- `src/cli.ts`: maps `isms-agent pack install` to `installPack()` and prints JSON results.
- `test/commands/pack.test.ts`: verifies the pack install API and CLI behavior.
- `src/commands/evidence.ts`: owns evidence indexing, manual review, Cloudflare bulk review, public export, and evidence validation.
- `test/commands/evidence.test.ts`: verifies Cloudflare bulk review idempotency and accepted-review preservation.
- `docs/evidence-templates/cloudflare/*.md`: documents accepted operating evidence expectations for Cloudflare-related requirements.
- `test/docs/evidence-templates.test.ts`: checks that accepted-evidence templates contain private storage and public-safety language.
- `packs/isms-p-core-v0/pack.json`: curated pack manifest updated with the first expansion batch.
- `packs/isms-p-core-v0/sources/source-manifest.json`: public OpenKB source manifest updated with new wiki/compiled source references.
- `packs/isms-p-core-v0/controls/*.json`: curated control files, including five new controls.
- `src/generator/openkb-types.ts`: OpenKB row types, including source-claim effective status.
- `src/generator/openkb-pack.ts`: OpenKB pack generator; must respect OpenKB effective status when annex status and source claims differ.
- `test/packs/isms-p-core-v0.test.ts`: pack-level quality gates for source safety and requirement-level evidence mappings.
- `README.md`, `docs/security-model.md`, `docs/connectors/cloudflare.md`: user-facing CLI and evidence-safety documentation.

## Implementation Order

1. Add `isms-agent pack install`.
2. Make `evidence review-cloudflare` idempotent for unchanged latest decisions.
3. Add accepted operating evidence templates.
4. Expand the core pack with the first five small-batch controls.
5. Run evaluation-service dogfood and final public-safety gates.

---

### Task 1: Add Pack Install Command

**Files:**
- Modify: `src/commands/pack.ts`
- Modify: `src/cli.ts`
- Modify: `test/commands/pack.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Write the failing pack install API test**

Update the imports in `test/commands/pack.test.ts`:

```ts
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { installPack, validatePack } from "../../src/commands/pack.js";
```

Add this test after `validatePack accepts the checked-in core v0 pack`:

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

- [ ] **Step 2: Run the targeted failing test**

Run:

```bash
npm run build
node --test dist/test/commands/pack.test.js
```

Expected result:

```text
FAIL
```

The failure must mention that `installPack` is not exported or not defined.

- [ ] **Step 3: Implement `installPack()`**

Update imports in `src/commands/pack.ts`:

```ts
import { constants } from "node:fs";
import { copyFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
```

Add these interfaces near the existing exported pack interfaces:

```ts
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
```

Add this function after `generatePack()`:

```ts
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

Add this helper near the other pack helpers:

```ts
async function jsonControlFileNames(directory: string): Promise<string[]> {
  return (await readdir(directory))
    .filter((name) => name.endsWith(".json"))
    .sort((left, right) => left.localeCompare(right, "en"));
}
```

- [ ] **Step 4: Add the CLI route and argument parser**

Update the pack import in `src/cli.ts`:

```ts
import { generatePack, installPack, parsePackGenerateArgs, validatePack } from "./commands/pack.js";
```

Add this route before the existing `pack generate` route:

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

Add this parser near `parseEvidenceIndexArgs()`:

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

Add this usage line to the CLI usage block:

```ts
  console.error("Usage: isms-agent pack install [pack-dir] [--overwrite]");
```

- [ ] **Step 5: Add the CLI pack install test**

Add this test to `test/commands/pack.test.ts`:

```ts
test("CLI installs a selected pack into workspace controls", async () => {
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
    assert.deepEqual(parsed.skippedControls, []);
    assert.equal(
      await readdir(join(dir, "controls")).then((names) => names.filter((name) => name.endsWith(".json")).length),
      3
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 6: Document pack install**

Add this section under the pack validation examples in `README.md`:

````md
Install a curated pack into a workspace before generating reports:

```bash
isms-agent pack install packs/isms-p-core-v0 --overwrite
isms-agent report --public
```

`pack install` validates the pack first, then copies public control JSON files into `controls/`. Existing workspace controls are preserved unless `--overwrite` is passed.
````

- [ ] **Step 7: Verify and commit Task 1**

Run:

```bash
npm test
npm run check
git diff --check
node dist/cli.js pack install packs/isms-p-core-v0 --overwrite
```

Expected result:

```text
tests pass
typecheck passes
diff check passes
pack install prints installedControls
```

Commit:

```bash
git add src/commands/pack.ts src/cli.ts test/commands/pack.test.ts README.md
git commit -m "feat: install curated control packs"
```

Leave generated workspace `controls/` output untracked.

---

### Task 2: Make Cloudflare Review Reruns Idempotent

**Files:**
- Modify: `src/commands/evidence.ts`
- Modify: `test/commands/evidence.test.ts`
- Modify: `docs/superpowers/specs/2026-05-29-cloudflare-review-overlay-design.md`

- [ ] **Step 1: Write the failing idempotency test**

Add this test after `reviewCloudflareEvidence appends needs_followup records that satisfy public validation review warnings`:

```ts
test("reviewCloudflareEvidence skips unchanged latest non-accepted decisions on rerun", async () => {
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

    assert.equal(second.outputPath, undefined);
    assert.equal(second.reviewedEvidence, 0);
    assert.equal(second.reviewRecords, 0);
    assert.equal(second.skippedEvidence, 3);
    assert.deepEqual(second.skipped.map((item) => item.reason), [
      "existing unchanged needs_followup review decision for ISMS-P-2.10.2.cloudflare-config-export",
      "existing unchanged needs_followup review decision for ISMS-P-2.10.2.cloudflare-config-export",
      "existing unchanged needs_followup review decision for ISMS-P-2.10.2.cloud-change-approval"
    ]);

    const rows = (await readFile(join(dir, "reviews", "evidence-review.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((row) => row.reviewed_at), [
      "2026-05-29T01:00:00.000Z",
      "2026-05-29T01:00:00.000Z",
      "2026-05-29T01:00:00.000Z"
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

Add this test after it:

```ts
test("reviewCloudflareEvidence appends when latest non-accepted decision changes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-review-cloudflare-state-change-"));
  try {
    await mkdir(join(dir, "evidence"), { recursive: true });
    await writeFile(join(dir, "evidence", "index.jsonl"), cloudflareEvidenceRows().slice(0, 1).map((row) => JSON.stringify(row)).join("\n") + "\n");

    await reviewCloudflareEvidence(dir, {
      reviewer: "security-owner",
      reviewedAt: new Date("2026-05-29T01:00:00.000Z")
    });

    const changed = await reviewCloudflareEvidence(dir, {
      decision: "rejected",
      rationale: "This Cloudflare signal is not in the certification scope.",
      reviewer: "security-owner",
      reviewedAt: new Date("2026-05-29T02:00:00.000Z")
    });

    assert.equal(changed.reviewRecords, 1);
    assert.equal(changed.records[0]?.decision, "rejected");

    const rows = (await readFile(join(dir, "reviews", "evidence-review.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(rows.map((row) => row.decision), ["needs_followup", "rejected"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the targeted failing test**

Run:

```bash
npm run build
node --test dist/test/commands/evidence.test.js
```

Expected result:

```text
FAIL
```

The idempotency test must fail because the second run appends duplicate `needs_followup` records.

- [ ] **Step 3: Replace accepted-only lookup with latest review lookup**

In `src/commands/evidence.ts`, replace this line inside `reviewCloudflareEvidence()`:

```ts
  const acceptedReviewKeys = await latestAcceptedReviewKeys(workspaceRoot);
```

with:

```ts
  const latestReviews = await latestReviewByKey(workspaceRoot);
```

Replace this block:

```ts
      const reviewKey = `${item.evidence_id}\0${requirementId}`;
      if (acceptedReviewKeys.has(reviewKey)) {
        skipped.push({
          evidence_id: item.evidence_id,
          reason: `existing accepted review decision for ${requirementId}`
        });
        continue;
      }
```

with:

```ts
      const reviewKey = `${item.evidence_id}\0${requirementId}`;
      const latestReview = latestReviews.get(reviewKey);
      if (latestReview?.decision === "accepted") {
        skipped.push({
          evidence_id: item.evidence_id,
          reason: `existing accepted review decision for ${requirementId}`
        });
        continue;
      }
      if (latestReview && latestReview.decision === decision && latestReview.rationale.trim() === rationale.trim()) {
        skipped.push({
          evidence_id: item.evidence_id,
          reason: `existing unchanged ${decision} review decision for ${requirementId}`
        });
        continue;
      }
```

- [ ] **Step 4: Replace the helper**

Replace `latestAcceptedReviewKeys()` with this helper:

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

- [ ] **Step 5: Update review overlay documentation**

Add this subsection after the dry-run section in `docs/superpowers/specs/2026-05-29-cloudflare-review-overlay-design.md`:

```md
### 6.2.1 Rerun Idempotency

Bulk review is append-only for state changes, but rerunning the same decision and rationale must not append duplicate records.

For each `evidence_id` and `requirement_id` pair:

- if the latest review is `accepted`, bulk review skips the pair,
- if the latest review has the same non-accepted decision and same rationale, bulk review skips the pair,
- if the decision or rationale changes, bulk review appends a new record.

This keeps dogfood runs repeatable while preserving review history when a reviewer intentionally changes state.
```

- [ ] **Step 6: Verify and commit Task 2**

Run:

```bash
npm test
npm run check
git diff --check
```

Expected result:

```text
tests pass
typecheck passes
diff check passes
```

Commit:

```bash
git add src/commands/evidence.ts test/commands/evidence.test.ts docs/superpowers/specs/2026-05-29-cloudflare-review-overlay-design.md
git commit -m "fix: make cloudflare review reruns idempotent"
```

---

### Task 3: Add Accepted Operating Evidence Templates

**Files:**
- Create: `docs/evidence-templates/cloudflare/ISMS-P-2.10.2-cloud-admin-access-review.md`
- Create: `docs/evidence-templates/cloudflare/ISMS-P-2.10.2-cloud-change-approval.md`
- Create: `docs/evidence-templates/cloudflare/ISMS-P-2.10.2-cloud-security-review.md`
- Create: `test/docs/evidence-templates.test.ts`
- Modify: `README.md`
- Modify: `docs/security-model.md`

- [ ] **Step 1: Write the failing template coverage test**

Create `test/docs/evidence-templates.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const ROOT = process.cwd();

const CLOUDFLARE_TEMPLATES = [
  "docs/evidence-templates/cloudflare/ISMS-P-2.10.2-cloud-admin-access-review.md",
  "docs/evidence-templates/cloudflare/ISMS-P-2.10.2-cloud-change-approval.md",
  "docs/evidence-templates/cloudflare/ISMS-P-2.10.2-cloud-security-review.md"
];

test("Cloudflare accepted evidence templates define private storage and public safety rules", async () => {
  for (const template of CLOUDFLARE_TEMPLATES) {
    const content = await readFile(join(ROOT, template), "utf8");
    assert.match(content, /Accepted Criteria/);
    assert.match(content, /Private Storage/);
    assert.match(content, /Public Export Rule/);
    assert.match(content, /evidence\/private\/ISMS-P-2\.10\.2/);
    assert.match(content, /isms-agent evidence review/);
    assert.doesNotMatch(content, /cfat_|account id|zone id|token/i);
  }
});
```

- [ ] **Step 2: Run the targeted failing test**

Run:

```bash
npm run build
node --test dist/test/docs/evidence-templates.test.js
```

Expected result:

```text
FAIL
```

The failure must mention missing template files.

- [ ] **Step 3: Create the Cloud admin access review template**

Create `docs/evidence-templates/cloudflare/ISMS-P-2.10.2-cloud-admin-access-review.md`:

````md
# ISMS-P-2.10.2 Cloud Admin Access Review

Requirement: `ISMS-P-2.10.2.cloud-admin-access-review`

## Purpose

Confirm that Cloudflare administrator access is periodically reviewed and limited to current operational need.

## Accepted Criteria

- The record lists the review date, reviewer, scope, and Cloudflare administrator role categories.
- The record confirms whether privileged users still need access.
- Removed or changed access is linked to a follow-up record.
- The record is dated and owned by a human reviewer.

## Private Storage

Store the real record under:

```text
evidence/private/ISMS-P-2.10.2/access-review/
```

Do not commit the private record, user list, email addresses, account identifiers, screenshots, or raw Cloudflare exports.

## Public Export Rule

Public reports may state that an access review record exists or is missing. Public reports must not include user identities, role assignments, account identifiers, screenshots, or review rationale.

## Review Command

After the private record exists and the owner confirms it, record the accepted review:

```bash
isms-agent evidence review <evidence-id> \
  --requirement ISMS-P-2.10.2.cloud-admin-access-review \
  --decision accepted \
  --rationale "Private Cloudflare administrator access review confirmed by the security owner." \
  --reviewer security-owner
```
````

- [ ] **Step 4: Create the Cloud change approval template**

Create `docs/evidence-templates/cloudflare/ISMS-P-2.10.2-cloud-change-approval.md`:

````md
# ISMS-P-2.10.2 Cloud Change Approval

Requirement: `ISMS-P-2.10.2.cloud-change-approval`

## Purpose

Confirm that security-sensitive Cloudflare changes are reviewed and approved before or shortly after implementation.

## Accepted Criteria

- The record identifies the change category, requester, approver, date, and reason.
- The record links the change to a Cloudflare configuration area without exposing private resource names.
- The record shows approval, rejection, or follow-up.
- Emergency changes include a retrospective review.

## Private Storage

Store the real record under:

```text
evidence/private/ISMS-P-2.10.2/change-approval/
```

Do not commit change tickets, screenshots, resource names, account identifiers, or raw Cloudflare exports.

## Public Export Rule

Public reports may show whether change approval evidence is accepted, missing, expired, or needs follow-up. Public reports must not expose ticket contents, reviewer rationale, private hostnames, resource names, account identifiers, or screenshots.

## Review Command

After the private record exists and the owner confirms it, record the accepted review:

```bash
isms-agent evidence review <evidence-id> \
  --requirement ISMS-P-2.10.2.cloud-change-approval \
  --decision accepted \
  --rationale "Private Cloudflare change approval record confirmed by the security owner." \
  --reviewer security-owner
```
````

- [ ] **Step 5: Create the Cloud security review template**

Create `docs/evidence-templates/cloudflare/ISMS-P-2.10.2-cloud-security-review.md`:

````md
# ISMS-P-2.10.2 Cloud Security Review

Requirement: `ISMS-P-2.10.2.cloudflare-config-export`

## Purpose

Confirm that Cloudflare configuration snapshots are reviewed as part of a dated cloud security review instead of accepted only because a scanner observed settings.

## Accepted Criteria

- The record includes review date, reviewer, scope, and reviewed Cloudflare configuration areas.
- The record identifies follow-up items or confirms no follow-up is required.
- The reviewed configuration snapshot is stored privately.
- The review is linked to the current service scope.

## Private Storage

Store the real record under:

```text
evidence/private/ISMS-P-2.10.2/security-review/
```

Do not commit raw configuration exports, account identifiers, zone identifiers, DNS values, private resource names, screenshots, or reviewer notes.

## Public Export Rule

Public reports may show the review status of `ISMS-P-2.10.2.cloudflare-config-export`. Public reports must not include raw exports, Cloudflare identifiers, DNS values, private resource names, screenshots, or private reviewer rationale.

## Review Command

After the private record exists and the owner confirms it, record the accepted review:

```bash
isms-agent evidence review <evidence-id> \
  --requirement ISMS-P-2.10.2.cloudflare-config-export \
  --decision accepted \
  --rationale "Private Cloudflare security review record confirmed by the security owner." \
  --reviewer security-owner
```
````

- [ ] **Step 6: Document the accepted-evidence path**

Add this paragraph to `docs/security-model.md` after the Cloudflare review overlay paragraph:

```md
Accepted Cloudflare operating evidence must be created through a manual review of a private record. The templates under `docs/evidence-templates/cloudflare/` define the accepted criteria, private storage path, and public export rule for administrator access review, change approval, and dated cloud security review records.
```

Add this paragraph to the Cloudflare review section in `README.md`:

```md
Accepted Cloudflare evidence is a manual operating-evidence decision. Use the templates in `docs/evidence-templates/cloudflare/` before recording `--decision accepted`; scanner output alone is not enough.
```

- [ ] **Step 7: Verify and commit Task 3**

Run:

```bash
npm test
npm run check
git diff --check
```

Expected result:

```text
tests pass
typecheck passes
diff check passes
```

Commit:

```bash
git add docs/evidence-templates/cloudflare test/docs/evidence-templates.test.ts README.md docs/security-model.md
git commit -m "docs: add accepted cloudflare evidence templates"
```

---

### Task 4: Expand the Core Pack with the First Small Batch

**Files:**
- Modify: `packs/isms-p-core-v0/pack.json`
- Modify: `packs/isms-p-core-v0/sources/source-manifest.json`
- Add: `packs/isms-p-core-v0/controls/ISMS-P-2.1.1.json`
- Add: `packs/isms-p-core-v0/controls/ISMS-P-2.3.1.json`
- Add: `packs/isms-p-core-v0/controls/ISMS-P-2.2.4.json`
- Add: `packs/isms-p-core-v0/controls/ISMS-P-2.9.4.json`
- Add: `packs/isms-p-core-v0/controls/ISMS-P-2.10.1.json`
- Modify: `src/generator/openkb-types.ts`
- Modify: `src/generator/openkb-pack.ts`
- Modify: `test/generator/openkb-pack.test.ts`
- Modify: `test/packs/isms-p-core-v0.test.ts`

- [ ] **Step 1: Write the failing effective-status generator test**

Add this test to `test/generator/openkb-pack.test.ts` before `generatePackFromOpenKb writes active and deleted residual-risk controls`:

```ts
test("generatePackFromOpenKb uses source claim effective_status when annex status is deleted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-pack-generate-effective-status-"));
  try {
    const openkbRoot = join(dir, "openkb");
    const packRoot = join(dir, "pack");
    await writeMinimalOpenKb(openkbRoot, {
      controlId: "ISMS-P-2.2.4",
      controlName: "인식제고 및 교육훈련",
      annexStatus: "삭제",
      effectiveStatus: "유지",
      wikiFileName: "ISMS-P-2.2.4_인식제고_및_교육훈련.md"
    });

    await generatePackFromOpenKb({
      openkbRoot,
      packRoot,
      packName: "generated-pack",
      version: "0.2.0",
      controlIds: ["ISMS-P-2.2.4"]
    });

    const generated = JSON.parse(await readFile(join(packRoot, "controls", "ISMS-P-2.2.4.json"), "utf8"));
    assert.equal(generated.control_id, "ISMS-P-2.2.4");
    assert.equal(generated.title, "인식제고 및 교육훈련");
    assert.equal(generated.pack.effective_status, "active");
    assert.equal(generated.pack.review_status, "needs_human_review");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

Update the `writeMinimalOpenKb()` options type:

```ts
options: {
  controlId: string;
  controlName: string;
  annexStatus?: "유지" | "삭제";
  effectiveStatus?: "유지" | "삭제";
  mergedInto?: string;
  wikiFileName: string;
}
```

Update the `annex_7_2_mapping.jsonl` fixture row inside `writeMinimalOpenKb()`:

```ts
      status: options.annexStatus ?? "유지",
```

Add `effective_status` to the `source_claims.jsonl` fixture row:

```ts
      effective_status: options.effectiveStatus ?? options.annexStatus ?? "유지",
```

- [ ] **Step 2: Run the targeted failing generator test**

Run:

```bash
npm run build
node --test dist/test/generator/openkb-pack.test.js
```

Expected result:

```text
FAIL
```

The new test must fail because `SourceClaimRow` and `buildControl()` do not use `effective_status` yet.

- [ ] **Step 3: Implement OpenKB effective-status handling**

Update `SourceClaimRow` in `src/generator/openkb-types.ts`:

```ts
export interface SourceClaimRow {
  claim_id: string;
  control_id: string;
  control_name: string;
  effective_status?: "유지" | "삭제" | string;
  confidence: "ocr_derived" | "official_verified" | "human_curated" | string;
  review_status: "needs_human_review" | "reviewed" | string;
  source_path: string;
  pages: number[];
}
```

In `src/generator/openkb-pack.ts`, replace:

```ts
  const effectiveStatus = mapEffectiveStatus(input.annex.status);
```

with:

```ts
  const effectiveStatus = mapEffectiveStatus(input.claim?.effective_status ?? input.annex.status);
```

This preserves deleted residual-risk behavior when OpenKB effective status is `삭제`, while allowing 7의3-active controls such as `ISMS-P-2.2.4` to be generated as active even when annex 7의2 says `삭제`.

- [ ] **Step 4: Verify generator update**

Run:

```bash
npm test
npm run check
git diff --check
```

Expected result:

```text
tests pass
typecheck passes
diff check passes
```

- [ ] **Step 5: Generate a draft pack from OpenKB**

Run:

```bash
node dist/cli.js pack generate \
  --openkb /Users/jeean/Documents/obsidian-vault/evaluate.club/09_보안_ISMS-P_openkb \
  --pack packs/isms-p-core-v1 \
  --controls ISMS-P-2.1.1,ISMS-P-2.2.4,ISMS-P-2.3.1,ISMS-P-2.9.4,ISMS-P-2.10.1 \
  --version 0.2.0
```

Expected result:

```json
{
  "generatedControls": [
    "ISMS-P-2.1.1",
    "ISMS-P-2.2.4",
    "ISMS-P-2.3.1",
    "ISMS-P-2.9.4",
    "ISMS-P-2.10.1"
  ]
}
```

The `packRoot` value may be absolute; it must end with `packs/isms-p-core-v1`.

- [ ] **Step 6: Validate the draft pack**

Run:

```bash
node dist/cli.js pack validate packs/isms-p-core-v1
```

Expected result:

```json
{
  "valid": true,
  "checkedControls": 5,
  "issues": []
}
```

- [ ] **Step 7: Write the failing expected-control test**

Update the expected list in `test/packs/isms-p-core-v0.test.ts`:

```ts
  assert.deepEqual(names, [
    "ISMS-P-2.1.1.json",
    "ISMS-P-2.10.1.json",
    "ISMS-P-2.10.2.json",
    "ISMS-P-2.2.4.json",
    "ISMS-P-2.3.1.json",
    "ISMS-P-2.5.3.json",
    "ISMS-P-2.5.6.json",
    "ISMS-P-2.9.4.json"
  ]);
```

Update the expected control IDs:

```ts
  assert.deepEqual(controls.map((control) => control.control_id).sort(), [
    "ISMS-P-2.1.1",
    "ISMS-P-2.10.1",
    "ISMS-P-2.10.2",
    "ISMS-P-2.2.4",
    "ISMS-P-2.3.1",
    "ISMS-P-2.5.3",
    "ISMS-P-2.5.6",
    "ISMS-P-2.9.4"
  ]);
```

Change the active-control count:

```ts
  assert.equal(active.length, 6);
```

- [ ] **Step 8: Add the failing requirement-quality test**

Add this test to `test/packs/isms-p-core-v0.test.ts`:

```ts
test("active pack controls have requirement-level evidence mappings", async () => {
  const controls = await loadPackControls();
  for (const control of controls.filter((item) => item.pack?.effective_status === "active")) {
    assert.ok((control.requirements?.length ?? 0) >= 2, `${control.control_id} should have at least two evidence requirements`);
    for (const requirement of control.requirements ?? []) {
      assert.equal(requirement.control_id, control.control_id);
      assert.match(requirement.requirement_id, new RegExp(`^${control.control_id}\\.`));
      assert.ok(requirement.title.length > 0, `${requirement.requirement_id} must have title`);
      assert.ok(requirement.evidence_types.length > 0, `${requirement.requirement_id} must list evidence_types`);
      assert.ok(requirement.source_refs.length > 0, `${requirement.requirement_id} must cite source_refs`);
      assert.equal(
        requirement.source_refs.some((sourceRef) => sourceRef.sourcePath.startsWith("raw/legal/")),
        false,
        `${requirement.requirement_id} must not cite raw legal direct refs`
      );
    }
  }
});
```

- [ ] **Step 9: Run the failing pack tests**

Run:

```bash
npm run build
node --test dist/test/packs/isms-p-core-v0.test.js
```

Expected result:

```text
FAIL
```

The expected-control test must fail until the five new controls are promoted into `packs/isms-p-core-v0`.

- [ ] **Step 10: Promote generated controls into the curated pack**

Copy the generated controls from:

```text
packs/isms-p-core-v1/controls/
```

into:

```text
packs/isms-p-core-v0/controls/
```

Each new control must be curated so these fields are specific and reviewable:

```json
{
  "automation_potential": "partial",
  "human_review_required": true,
  "pack": {
    "name": "isms-p-core-v0",
    "source_of_truth": "openkb",
    "review_status": "reviewed"
  }
}
```

Use these requirement IDs for the first batch:

```text
ISMS-P-2.1.1.policy-inventory
ISMS-P-2.1.1.policy-review-record
ISMS-P-2.1.1.policy-approval-history
ISMS-P-2.2.4.security-training-plan
ISMS-P-2.2.4.training-completion-record
ISMS-P-2.2.4.missing-participant-followup
ISMS-P-2.3.1.external-party-inventory
ISMS-P-2.3.1.external-party-access-purpose
ISMS-P-2.3.1.external-party-periodic-review
ISMS-P-2.9.4.log-retention-policy
ISMS-P-2.9.4.log-collection-configuration
ISMS-P-2.9.4.log-review-record
ISMS-P-2.10.1.security-system-inventory
ISMS-P-2.10.1.security-system-baseline
ISMS-P-2.10.1.security-system-operation-review
```

Use these evidence types:

```text
policy_document
procedure_document
configuration_export
access_review_record
change_approval_record
audit_log
implementation_file
test_result
connector_snapshot
applicability_note
```

All requirement `source_refs` must point to `compiled/` or `wiki/` OpenKB paths already present in the control `source_refs`.

- [ ] **Step 11: Update `pack.json`**

Update `packs/isms-p-core-v0/pack.json` so it contains:

```json
{
  "schemaVersion": 1,
  "name": "isms-p-core-v0",
  "version": "0.2.0",
  "sourceOfTruth": "openkb",
  "sourceRootKind": "openkb-relative",
  "controlCount": 8,
  "controls": [
    "ISMS-P-2.1.1",
    "ISMS-P-2.2.4",
    "ISMS-P-2.3.1",
    "ISMS-P-2.5.3",
    "ISMS-P-2.5.6",
    "ISMS-P-2.9.4",
    "ISMS-P-2.10.1",
    "ISMS-P-2.10.2"
  ],
  "reviewStatus": "reviewed",
  "sourceConfidence": "ocr_derived",
  "publicSafety": {
    "containsPrivateServicePaths": false,
    "containsCustomerData": false,
    "containsSensitiveCredentials": false
  }
}
```

- [ ] **Step 12: Update `source-manifest.json`**

Update `packs/isms-p-core-v0/sources/source-manifest.json` so `openkbSources` includes these public OpenKB sources:

```json
[
  "compiled/controls/annex_7_2_mapping.jsonl",
  "compiled/citations/source_claims.jsonl",
  "compiled/evidence/evidence_requirements.jsonl",
  "wiki/controls/2_보호대책_요구사항/ISMS-P-2.1.1_정책의_유지관리.md",
  "wiki/controls/2_보호대책_요구사항/ISMS-P-2.2.4_인식제고_및_교육훈련.md",
  "wiki/controls/2_보호대책_요구사항/ISMS-P-2.3.1_외부자_현황_관리.md",
  "wiki/controls/2_보호대책_요구사항/ISMS-P-2.5.3_사용자_인증.md",
  "wiki/controls/2_보호대책_요구사항/ISMS-P-2.5.6_접근권한_검토.md",
  "wiki/controls/2_보호대책_요구사항/ISMS-P-2.9.4_로그_및_접속기록_관리.md",
  "wiki/controls/2_보호대책_요구사항/ISMS-P-2.10.1_보안시스템_운영.md",
  "wiki/controls/2_보호대책_요구사항/ISMS-P-2.10.2_클라우드_보안.md"
]
```

Keep:

```json
{
  "privateOverlaysIncluded": false
}
```

Keep raw legal rows only in `sourceProfileReferences`, not in `openkbSources`.

- [ ] **Step 13: Verify Task 4**

Run:

```bash
npm test
npm run check
git diff --check
node dist/cli.js pack validate packs/isms-p-core-v0
node dist/cli.js pack install packs/isms-p-core-v0 --overwrite
node dist/cli.js evidence validate --public
node dist/cli.js report --public
```

Expected result:

```text
tests pass
typecheck passes
diff check passes
pack validation valid true with checkedControls 8
pack install writes 8 controls
public evidence validation valid true
public reports generate under reports/
```

If `report --public` fails because no scan exists in the current workspace, run a current scan first:

```bash
node dist/cli.js scan --local --target .
node dist/cli.js evidence index
node dist/cli.js report --public
```

- [ ] **Step 14: Commit Task 4**

Commit:

```bash
git add src/generator/openkb-types.ts src/generator/openkb-pack.ts test/generator/openkb-pack.test.ts packs/isms-p-core-v0 test/packs/isms-p-core-v0.test.ts
git commit -m "feat: expand core control pack"
```

Do not commit `packs/isms-p-core-v1`, `controls/`, `evidence/`, `reviews/`, `scans/`, or `reports/` unless a later decision explicitly changes the public artifact policy.

---

### Task 5: Final Dogfood and PR Gate

**Files:**
- Modify: `docs/connectors/cloudflare.md`
- Modify: `docs/security-model.md`
- Modify: `README.md`

- [ ] **Step 1: Run the end-to-end evaluation workspace flow**

Run:

```bash
node dist/cli.js pack install packs/isms-p-core-v0 --overwrite
node dist/cli.js evidence review-cloudflare --dry-run
node dist/cli.js evidence review-cloudflare --decision needs_followup --reviewer security-owner
node dist/cli.js evidence validate --public
node dist/cli.js report --public
```

Expected result:

```text
pack install writes 8 controls
review-cloudflare dry run reports existing or proposed records
review-cloudflare actual run does not duplicate unchanged latest decisions
public evidence validation returns valid true
public reports generate
```

- [ ] **Step 2: Document dogfood result**

Add a short dated note to `docs/connectors/cloudflare.md`:

```md
## Dogfood Note: 2026-05-29

The evaluation-service dry run confirmed that Cloudflare scanner evidence remains candidate evidence. Bulk review records `needs_followup` by default, reruns skip unchanged latest decisions, and public validation/report generation do not expose private review rationale.
```

Add a short dated note to `docs/security-model.md`:

```md
## Dogfood Note: 2026-05-29

Small-batch control expansion keeps real evidence local. The public repository includes curated control knowledge and public-safe documentation, while `evidence/private/`, `reviews/`, `scans/`, and `reports/` remain local workspace state unless a public-safe export command creates redacted output.
```

- [ ] **Step 3: Run the final gate**

Run:

```bash
npm test
npm run check
git diff --check
node dist/cli.js pack validate packs/isms-p-core-v0
node dist/cli.js evidence validate --public
node dist/cli.js report --public
```

Expected result:

```text
tests pass
typecheck passes
diff check passes
pack validation valid true with checkedControls 8
public evidence validation valid true
public reports generate
```

- [ ] **Step 4: Commit documentation updates**

Commit:

```bash
git add docs/connectors/cloudflare.md docs/security-model.md README.md
git commit -m "docs: record small-batch expansion dogfood"
```

- [ ] **Step 5: Open PR**

Run:

```bash
git status --short
git push -u origin codex/small-batch-control-expansion-design
gh pr create --title "Implement small-batch control expansion path" --body "Implements pack install, Cloudflare review idempotency, accepted evidence templates, and the first OpenKB small-batch control expansion."
```

Expected result:

```text
working tree clean
branch pushed
PR URL printed
```

## Self-Review Mapping

- Spec decision to use OpenKB small batches: Task 4.
- Source-of-truth and public source reference rules: Task 4 tests and pack validator gates.
- Runtime flow stabilization: Task 1 and Task 5.
- Review overlay conservatism and rerun behavior: Task 2.
- Accepted evidence must require private operating records: Task 3.
- First five selected controls: Task 4.
- Dogfood against evaluation service: Task 5.
