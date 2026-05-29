# evidence add Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `isms-agent evidence add` so users can register existing private operating evidence as public-safe manual evidence metadata.

**Architecture:** Add a command-level API in `src/commands/evidence.ts` that validates an existing `evidence/private/...` file or directory, computes a stable content hash, and rewrites `evidence/index.jsonl` with a sorted manual `EvidenceItem`. Wire the API into `src/cli.ts`; keep accepted decisions in the existing `evidence review --decision accepted --private-evidence ...` flow.

**Tech Stack:** TypeScript, Node.js 22, built-in `node:test`, existing JSONL evidence index, existing public evidence validator, existing CLI parser pattern.

---

## File Structure

- Modify `src/schemas/evidence.ts`
  - Export existing evidence union types if needed by command option types.
- Modify `src/commands/evidence.ts`
  - Add `EvidenceAddOptions` and `EvidenceAddResult`.
  - Add `addManualEvidence()`.
  - Add manual evidence validation helpers.
  - Add file and directory content hashing helpers.
  - Reuse or generalize private evidence path resolution for both `evidence add` and accepted reviews.
- Modify `src/cli.ts`
  - Add `evidence add` dispatch.
  - Add `parseEvidenceAddArgs()`.
  - Update usage text.
- Modify `test/commands/evidence.test.ts`
  - Add command API tests.
  - Add CLI parsing flow test.
  - Add report/validation integration tests for manual evidence.
- Modify `README.md`
  - Document manual evidence registration.
- Modify `docs/security-model.md`
  - Document the boundary between private evidence, public-safe index metadata, and accepted review overlays.

## Task 1: Add Failing Command API Tests

**Files:**
- Modify: `test/commands/evidence.test.ts`

- [ ] **Step 1: Update imports**

Modify the import near the top of `test/commands/evidence.test.ts`:

```ts
import { addManualEvidence, exportPublicEvidence, indexEvidenceFromScan, reviewCloudflareEvidence, reviewEvidence, validateEvidence } from "../../src/commands/evidence.js";
```

- [ ] **Step 2: Add successful manual registration test**

Add this test before the existing CLI tests:

```ts
test("addManualEvidence registers existing private evidence without storing private path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-add-"));
  try {
    const privatePath = join(dir, "evidence", "private", "ISMS-P-2.5.3", "authentication-policy", "2026-Q2.md");
    await mkdir(join(privatePath, ".."), { recursive: true });
    await writeFile(privatePath, "# Authentication policy\n\nReviewed for 2026 Q2.\n");

    const result = await addManualEvidence(dir, {
      id: "ev_manual_auth_policy_2026_q2",
      title: "Authentication policy 2026 Q2",
      evidenceType: "policy_document",
      classification: "internal",
      supports: ["ISMS-P-2.5.3.authentication-policy"],
      privateEvidencePath: "evidence/private/ISMS-P-2.5.3/authentication-policy/2026-Q2.md",
      summary: "Authentication policy reviewed for 2026 Q2.",
      collectedAt: new Date("2026-05-29T00:00:00.000Z")
    });

    assert.equal(result.outputPath, join(dir, "evidence", "index.jsonl"));
    assert.equal(result.item.evidence_id, "ev_manual_auth_policy_2026_q2");
    assert.equal(result.item.origin, "manual");
    assert.equal(result.item.lifecycle_status, "needs_review");
    assert.equal(result.item.review_required, true);
    assert.deepEqual(result.item.supports, ["ISMS-P-2.5.3.authentication-policy"]);
    assert.deepEqual(result.item.locator, {
      kind: "external_reference",
      value: "ev_manual_auth_policy_2026_q2"
    });
    assert.equal(result.item.metadata.private_evidence_present, true);
    assert.equal(typeof result.item.content_sha256, "string");
    assert.equal(result.item.content_sha256?.length, 64);

    const content = await readFile(join(dir, "evidence", "index.jsonl"), "utf8");
    assert.match(content, /ev_manual_auth_policy_2026_q2/);
    assert.doesNotMatch(content, /evidence\/private/);
    assert.doesNotMatch(content, /2026-Q2\.md/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Add duplicate ID rejection test**

```ts
test("addManualEvidence rejects duplicate evidence ids", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-add-duplicate-"));
  try {
    const privatePath = join(dir, "evidence", "private", "ISMS-P-2.5.3", "review.md");
    await mkdir(join(privatePath, ".."), { recursive: true });
    await writeFile(privatePath, "review");
    await mkdir(join(dir, "evidence"), { recursive: true });
    await writeFile(join(dir, "evidence", "index.jsonl"), JSON.stringify(evidence({
      evidence_id: "ev_manual_auth_policy_2026_q2",
      origin: "manual"
    })) + "\n");

    await assert.rejects(addManualEvidence(dir, {
      id: "ev_manual_auth_policy_2026_q2",
      title: "Authentication policy 2026 Q2",
      evidenceType: "policy_document",
      classification: "internal",
      supports: ["ISMS-P-2.5.3.authentication-policy"],
      privateEvidencePath: "evidence/private/ISMS-P-2.5.3/review.md",
      summary: "Authentication policy reviewed for 2026 Q2."
    }), /Evidence id already exists in evidence\/index\.jsonl: ev_manual_auth_policy_2026_q2/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 4: Add private path validation tests**

```ts
test("addManualEvidence requires an existing private evidence path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-add-path-"));
  try {
    await assert.rejects(addManualEvidence(dir, {
      id: "ev_manual_auth_policy_2026_q2",
      title: "Authentication policy 2026 Q2",
      evidenceType: "policy_document",
      classification: "internal",
      supports: ["ISMS-P-2.5.3.authentication-policy"],
      privateEvidencePath: "evidence/private/ISMS-P-2.5.3/missing.md",
      summary: "Authentication policy reviewed for 2026 Q2."
    }), /Manual evidence private path does not exist/);

    const publicPath = join(dir, "project", "review.md");
    await mkdir(join(publicPath, ".."), { recursive: true });
    await writeFile(publicPath, "review");
    await assert.rejects(addManualEvidence(dir, {
      id: "ev_manual_auth_policy_2026_q3",
      title: "Authentication policy 2026 Q3",
      evidenceType: "policy_document",
      classification: "internal",
      supports: ["ISMS-P-2.5.3.authentication-policy"],
      privateEvidencePath: "project/review.md",
      summary: "Authentication policy reviewed for 2026 Q3."
    }), /Manual evidence private path must be under evidence\/private\//);

    await assert.rejects(addManualEvidence(dir, {
      id: "ev_manual_auth_policy_2026_q4",
      title: "Authentication policy 2026 Q4",
      evidenceType: "policy_document",
      classification: "internal",
      supports: ["ISMS-P-2.5.3.authentication-policy"],
      privateEvidencePath: "../outside.md",
      summary: "Authentication policy reviewed for 2026 Q4."
    }), /Manual evidence private path must be inside the workspace/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 5: Add classification and metadata validation tests**

```ts
test("addManualEvidence rejects unsafe classifications and metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-add-safety-"));
  try {
    const privatePath = join(dir, "evidence", "private", "ISMS-P-2.5.3", "review.md");
    await mkdir(join(privatePath, ".."), { recursive: true });
    await writeFile(privatePath, "review");

    await assert.rejects(addManualEvidence(dir, {
      id: "ev_manual_secret",
      title: "Secret evidence",
      evidenceType: "policy_document",
      classification: "secret",
      supports: ["ISMS-P-2.5.3.authentication-policy"],
      privateEvidencePath: "evidence/private/ISMS-P-2.5.3/review.md",
      summary: "Secret evidence."
    }), /Manual evidence classification secret is not supported/);

    await assert.rejects(addManualEvidence(dir, {
      id: "ev_manual_token_metadata",
      title: "Token metadata",
      evidenceType: "policy_document",
      classification: "internal",
      supports: ["ISMS-P-2.5.3.authentication-policy"],
      privateEvidencePath: "evidence/private/ISMS-P-2.5.3/review.md",
      summary: "Metadata includes unsafe key.",
      metadata: { token: "redacted-token-placeholder" }
    }), /Manual evidence metadata contains credential-like metadata at token/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 6: Run tests and verify failure**

Run:

```bash
npm run build
node --test dist/test/commands/evidence.test.js
```

Expected: FAIL because `addManualEvidence` is not exported from `src/commands/evidence.ts`.

## Task 2: Implement Manual Evidence Registration API

**Files:**
- Modify: `src/commands/evidence.ts`
- Modify: `src/schemas/evidence.ts` if TypeScript needs exported type names
- Test: `test/commands/evidence.test.ts`

- [ ] **Step 1: Extend imports in `src/commands/evidence.ts`**

Change the imports to include file-system and path helpers:

```ts
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
```

Keep existing imports that are already present. Do not introduce third-party dependencies.

- [ ] **Step 2: Update evidence schema type import**

Change the existing evidence type import in `src/commands/evidence.ts`:

```ts
import type { EvidenceClassification, EvidenceItem, EvidenceReviewRecord, EvidenceType, ReviewDecision } from "../schemas/evidence.js";
```

- [ ] **Step 3: Add option and result interfaces**

Add these interfaces after `EvidenceIndexResult`:

```ts
export interface EvidenceAddOptions {
  id: string;
  title: string;
  evidenceType: EvidenceType;
  classification: EvidenceClassification;
  supports: string[];
  privateEvidencePath: string;
  summary: string;
  validUntil?: string;
  metadata?: Record<string, string>;
  collectedAt?: Date;
}

export interface EvidenceAddResult {
  outputPath: string;
  item: EvidenceItem;
}
```

- [ ] **Step 4: Add allowed value constants**

Add these constants near the existing classification constants:

```ts
const MANUAL_EVIDENCE_CLASSIFICATIONS = new Set<EvidenceClassification>(["internal", "confidential", "public_sample"]);
const EVIDENCE_TYPES = new Set<EvidenceType>([
  "policy_document",
  "procedure_document",
  "configuration_export",
  "access_review_record",
  "change_approval_record",
  "audit_log",
  "implementation_file",
  "test_result",
  "connector_snapshot",
  "applicability_note"
]);
const MANUAL_EVIDENCE_ID_PATTERN = /^ev_[a-z0-9][a-z0-9_]{1,94}$/;
```

- [ ] **Step 5: Implement `addManualEvidence()`**

Add this function before `indexEvidenceFromScan()`:

```ts
export async function addManualEvidence(
  workspaceRoot: string,
  options: EvidenceAddOptions
): Promise<EvidenceAddResult> {
  validateManualEvidenceOptions(options);
  const privateEvidencePath = await resolvePrivateEvidencePath(
    workspaceRoot,
    options.privateEvidencePath,
    "Manual evidence private path"
  );
  const contentSha256 = await hashEvidencePath(resolve(workspaceRoot, privateEvidencePath));
  validateManualMetadata(options.metadata ?? {});

  const existingEvidence = await loadEvidenceIndex(workspaceRoot);
  if (existingEvidence.some((item) => item.evidence_id === options.id)) {
    throw new Error(`Evidence id already exists in evidence/index.jsonl: ${options.id}`);
  }

  const item: EvidenceItem = {
    evidence_id: options.id,
    title: options.title.trim(),
    evidence_type: options.evidenceType,
    classification: options.classification,
    lifecycle_status: "needs_review",
    origin: "manual",
    supports: [...new Set(options.supports.map((value) => value.trim()).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, "en")),
    locator: {
      kind: "external_reference",
      value: options.id
    },
    summary: options.summary.trim(),
    content_sha256: contentSha256,
    collected_at: (options.collectedAt ?? new Date()).toISOString(),
    ...(options.validUntil ? { valid_until: options.validUntil } : {}),
    review_required: true,
    metadata: {
      private_evidence_present: true,
      ...(options.metadata ?? {})
    }
  };

  const outputPath = await writeEvidenceIndex(workspaceRoot, [...existingEvidence, item]);
  return { outputPath, item };
}
```

- [ ] **Step 6: Add option validation helpers**

Add these helpers after `addManualEvidence()`:

```ts
function validateManualEvidenceOptions(options: EvidenceAddOptions): void {
  if (!MANUAL_EVIDENCE_ID_PATTERN.test(options.id)) {
    throw new Error("Manual evidence --id must match /^ev_[a-z0-9][a-z0-9_]{1,94}$/.");
  }
  if (!options.title.trim()) {
    throw new Error("Manual evidence requires --title.");
  }
  if (!EVIDENCE_TYPES.has(options.evidenceType)) {
    throw new Error(`Manual evidence type is not supported: ${options.evidenceType}`);
  }
  if (!MANUAL_EVIDENCE_CLASSIFICATIONS.has(options.classification)) {
    throw new Error(`Manual evidence classification ${options.classification} is not supported in evidence add v1.`);
  }
  if (options.supports.map((value) => value.trim()).filter(Boolean).length === 0) {
    throw new Error("Manual evidence requires at least one --supports requirement id.");
  }
  for (const requirementId of options.supports) {
    if (!requirementId.trim().startsWith("ISMS-P-")) {
      throw new Error(`Manual evidence --supports must use ISMS-P requirement ids: ${requirementId}`);
    }
  }
  if (!options.summary.trim()) {
    throw new Error("Manual evidence requires --summary.");
  }
  if (options.validUntil && Number.isNaN(Date.parse(options.validUntil))) {
    throw new Error(`Manual evidence --valid-until must be an ISO date: ${options.validUntil}`);
  }
}
```

- [ ] **Step 7: Generalize private evidence path resolution**

Replace `resolvePrivateEvidenceReference()` with this pair:

```ts
async function resolvePrivateEvidenceReference(workspaceRoot: string, inputPath: string | undefined): Promise<string> {
  if (!inputPath?.trim()) {
    throw new Error("Accepted evidence review requires --private-evidence under evidence/private/.");
  }
  return resolvePrivateEvidencePath(workspaceRoot, inputPath, "Accepted evidence private path");
}

async function resolvePrivateEvidencePath(workspaceRoot: string, inputPath: string, label: string): Promise<string> {
  const resolved = resolveWorkspacePath(workspaceRoot, inputPath, label);
  const relativePath = relative(resolve(workspaceRoot), resolved).replaceAll("\\", "/");
  if (!isPrivateEvidenceRelativePath(relativePath)) {
    throw new Error(`${label} must be under evidence/private/: ${inputPath}`);
  }

  try {
    await stat(resolved);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`${label} does not exist: ${inputPath}`);
    }
    throw error;
  }

  return relativePath;
}
```

Keep `isPrivateEvidenceRelativePath()` unchanged.

- [ ] **Step 8: Add index writer helper**

Add this helper near `loadEvidenceIndex()`:

```ts
async function writeEvidenceIndex(workspaceRoot: string, evidence: EvidenceItem[]): Promise<string> {
  const outputPath = join(workspaceRoot, "evidence", "index.jsonl");
  const sorted = [...evidence].sort((left, right) => left.evidence_id.localeCompare(right.evidence_id, "en"));
  await mkdir(join(workspaceRoot, "evidence"), { recursive: true });
  await writeFile(outputPath, sorted.map((item) => JSON.stringify(item)).join("\n") + (sorted.length > 0 ? "\n" : ""));
  return outputPath;
}
```

Then update `indexEvidenceFromScan()` to call `writeEvidenceIndex()` instead of duplicating write logic:

```ts
const evidence = [...nonScanEvidence, ...scan.signals.map((signal) => evidenceFromSignal(signal, scan.generatedAt))];
const outputPath = await writeEvidenceIndex(workspaceRoot, evidence);
```

- [ ] **Step 9: Add content hash helpers**

Add these helpers before `latestScanPath()`:

```ts
async function hashEvidencePath(path: string): Promise<string> {
  const pathStat = await stat(path);
  if (pathStat.isDirectory()) {
    return hashDirectory(path);
  }
  return hashFile(path);
}

async function hashFile(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function hashDirectory(root: string): Promise<string> {
  const entries = await directoryHashEntries(root, root);
  return sha256(entries.join("\n"));
}

async function directoryHashEntries(root: string, current: string): Promise<string[]> {
  const names = (await readdir(current)).filter((name) => name !== ".DS_Store").sort((left, right) => left.localeCompare(right, "en"));
  const entries: string[] = [];
  for (const name of names) {
    const path = join(current, name);
    const pathStat = await stat(path);
    if (pathStat.isDirectory()) {
      entries.push(...await directoryHashEntries(root, path));
      continue;
    }
    const relativeFilePath = relative(root, path).replaceAll("\\", "/");
    entries.push(`${relativeFilePath}\0${await hashFile(path)}`);
  }
  return entries;
}
```

- [ ] **Step 10: Add metadata validation**

Add this helper near `credentialLikeMetadataPath()`:

```ts
function validateManualMetadata(metadata: Record<string, string>): void {
  const credentialPath = credentialLikeMetadataPath(metadata);
  if (credentialPath) {
    throw new Error(`Manual evidence metadata contains credential-like metadata at ${credentialPath}.`);
  }
}
```

- [ ] **Step 11: Run command API tests**

Run:

```bash
npm run build
node --test dist/test/commands/evidence.test.js
```

Expected: new API tests pass except CLI tests that are not written yet.

- [ ] **Step 12: Commit Task 2**

```bash
git add src/commands/evidence.ts src/schemas/evidence.ts test/commands/evidence.test.ts
git commit -m "feat: add manual evidence registration API"
```

## Task 3: Wire `evidence add` Into the CLI

**Files:**
- Modify: `src/cli.ts`
- Modify: `test/commands/evidence.test.ts`

- [ ] **Step 1: Import `addManualEvidence`**

Update the evidence command import in `src/cli.ts`:

```ts
import { addManualEvidence, CLOUDFLARE_BULK_ACCEPTED_ERROR, exportPublicEvidence, indexEvidenceFromScan, reviewCloudflareEvidence, reviewEvidence, validateEvidence } from "./commands/evidence.js";
```

- [ ] **Step 2: Add CLI dispatch**

Add this block before the existing `evidence index` block:

```ts
if (command === "evidence" && args[0] === "add") {
  const parsed = parseEvidenceAddArgs(args.slice(1));
  if (parsed) {
    const result = await addManualEvidence(process.cwd(), parsed);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
}
```

- [ ] **Step 3: Update usage text**

Add this usage line before `evidence index`:

```ts
console.error("Usage: isms-agent evidence add --id <id> --title <text> --type <type> --classification <internal|confidential|public_sample> --supports <requirement-id> --private-evidence evidence/private/... --summary <text> [--valid-until <iso>] [--metadata key=value]");
```

- [ ] **Step 4: Add parser function**

Add this function before `parseEvidenceIndexArgs()`:

```ts
function parseEvidenceAddArgs(args: string[]): {
  id: string;
  title: string;
  evidenceType: "policy_document" | "procedure_document" | "configuration_export" | "access_review_record" | "change_approval_record" | "audit_log" | "implementation_file" | "test_result" | "connector_snapshot" | "applicability_note";
  classification: "internal" | "confidential" | "public_sample";
  supports: string[];
  privateEvidencePath: string;
  summary: string;
  validUntil?: string;
  metadata?: Record<string, string>;
} | undefined {
  const values = new Map<string, string[]>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    if (!arg.startsWith("--") || !value || value.startsWith("--")) {
      return undefined;
    }
    if (![
      "--id",
      "--title",
      "--type",
      "--classification",
      "--supports",
      "--private-evidence",
      "--summary",
      "--valid-until",
      "--metadata"
    ].includes(arg)) {
      return undefined;
    }
    values.set(arg, [...(values.get(arg) ?? []), value]);
    index += 1;
  }

  const id = single(values, "--id");
  const title = single(values, "--title");
  const evidenceType = single(values, "--type");
  const classification = single(values, "--classification");
  const privateEvidencePath = single(values, "--private-evidence");
  const summary = single(values, "--summary");
  const validUntil = singleOptional(values, "--valid-until");
  const supports = (values.get("--supports") ?? []).flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
  const metadata = parseMetadataArgs(values.get("--metadata") ?? []);

  if (!id || !title || !isEvidenceType(evidenceType) || !isManualClassification(classification) || !privateEvidencePath || !summary || supports.length === 0 || metadata === undefined) {
    return undefined;
  }

  return {
    id,
    title,
    evidenceType,
    classification,
    supports,
    privateEvidencePath,
    summary,
    ...(validUntil ? { validUntil } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {})
  };
}
```

- [ ] **Step 5: Add parser helper functions**

Add these helpers below `parseEvidenceAddArgs()`:

```ts
function single(values: Map<string, string[]>, key: string): string | undefined {
  const entries = values.get(key) ?? [];
  return entries.length === 1 ? entries[0] : undefined;
}

function singleOptional(values: Map<string, string[]>, key: string): string | undefined {
  const entries = values.get(key) ?? [];
  return entries.length <= 1 ? entries[0] : undefined;
}

function parseMetadataArgs(entries: string[]): Record<string, string> | undefined {
  const metadata: Record<string, string> = {};
  for (const entry of entries) {
    const separatorIndex = entry.indexOf("=");
    if (separatorIndex <= 0) {
      return undefined;
    }
    const key = entry.slice(0, separatorIndex).trim();
    const value = entry.slice(separatorIndex + 1).trim();
    if (!key || !value) {
      return undefined;
    }
    metadata[key] = value;
  }
  return metadata;
}

function isEvidenceType(value: string | undefined): value is "policy_document" | "procedure_document" | "configuration_export" | "access_review_record" | "change_approval_record" | "audit_log" | "implementation_file" | "test_result" | "connector_snapshot" | "applicability_note" {
  return value === "policy_document" ||
    value === "procedure_document" ||
    value === "configuration_export" ||
    value === "access_review_record" ||
    value === "change_approval_record" ||
    value === "audit_log" ||
    value === "implementation_file" ||
    value === "test_result" ||
    value === "connector_snapshot" ||
    value === "applicability_note";
}

function isManualClassification(value: string | undefined): value is "internal" | "confidential" | "public_sample" {
  return value === "internal" || value === "confidential" || value === "public_sample";
}
```

- [ ] **Step 6: Add CLI success test**

Add this test near other CLI tests in `test/commands/evidence.test.ts`:

```ts
test("CLI supports evidence add for existing private evidence", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-cli-add-"));
  try {
    const privatePath = join(dir, "evidence", "private", "ISMS-P-2.5.3", "authentication-policy", "2026-Q2.md");
    await mkdir(join(privatePath, ".."), { recursive: true });
    await writeFile(privatePath, "# Authentication policy\n");

    const result = spawnSync(process.execPath, [
      join(process.cwd(), "dist", "cli.js"),
      "evidence",
      "add",
      "--id",
      "ev_manual_auth_policy_2026_q2",
      "--title",
      "Authentication policy 2026 Q2",
      "--type",
      "policy_document",
      "--classification",
      "internal",
      "--supports",
      "ISMS-P-2.5.3.authentication-policy",
      "--private-evidence",
      "evidence/private/ISMS-P-2.5.3/authentication-policy/2026-Q2.md",
      "--summary",
      "Authentication policy reviewed for 2026 Q2.",
      "--metadata",
      "owner=security"
    ], {
      cwd: dir,
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout) as { item: EvidenceItem };
    assert.equal(parsed.item.evidence_id, "ev_manual_auth_policy_2026_q2");
    assert.equal(parsed.item.metadata.owner, "security");
    assert.equal(parsed.item.metadata.private_evidence_present, true);

    const content = await readFile(join(dir, "evidence", "index.jsonl"), "utf8");
    assert.doesNotMatch(content, /evidence\/private/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 7: Run CLI tests**

Run:

```bash
npm run build
node --test dist/test/commands/evidence.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

```bash
git add src/cli.ts test/commands/evidence.test.ts
git commit -m "feat: wire evidence add cli"
```

## Task 4: Add Report and Review Integration Coverage

**Files:**
- Modify: `test/commands/evidence.test.ts`
- Modify: `test/commands/report.test.ts` if the existing report tests are a better home

- [ ] **Step 1: Add test that `evidence index` preserves manual rows**

Add this test after the existing `indexEvidenceFromScan preserves existing non-scan evidence items` test:

```ts
test("indexEvidenceFromScan preserves evidence added manually", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-index-preserve-manual-add-"));
  try {
    const privatePath = join(dir, "evidence", "private", "ISMS-P-2.5.3", "policy.md");
    await mkdir(join(privatePath, ".."), { recursive: true });
    await writeFile(privatePath, "policy");
    await addManualEvidence(dir, {
      id: "ev_manual_auth_policy_2026_q2",
      title: "Authentication policy 2026 Q2",
      evidenceType: "policy_document",
      classification: "internal",
      supports: ["ISMS-P-2.5.3.authentication-policy"],
      privateEvidencePath: "evidence/private/ISMS-P-2.5.3/policy.md",
      summary: "Authentication policy reviewed for 2026 Q2."
    });
    await mkdir(join(dir, "scans"), { recursive: true });
    const scanPath = join(dir, "scans", "scan-2026-05-28T00-00-00-000Z.json");
    await writeFile(scanPath, stringifyJson(scanResult()));

    await indexEvidenceFromScan(dir, { fromScan: scanPath });

    const rows = (await readFile(join(dir, "evidence", "index.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as EvidenceItem);
    assert.equal(rows.some((row) => row.evidence_id === "ev_manual_auth_policy_2026_q2" && row.origin === "manual"), true);
    assert.equal(rows.some((row) => row.evidence_id === "ev_scan_local_docs_auth_mfa" && row.origin === "scan"), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Add validation and accepted review test**

Add this test near accepted review tests:

```ts
test("manual evidence remains review-required until accepted review references private evidence", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-add-review-"));
  try {
    const privatePath = join(dir, "evidence", "private", "ISMS-P-2.5.3", "policy.md");
    await mkdir(join(privatePath, ".."), { recursive: true });
    await writeFile(privatePath, "policy");
    await addManualEvidence(dir, {
      id: "ev_manual_auth_policy_2026_q2",
      title: "Authentication policy 2026 Q2",
      evidenceType: "policy_document",
      classification: "internal",
      supports: ["ISMS-P-2.5.3.authentication-policy"],
      privateEvidencePath: "evidence/private/ISMS-P-2.5.3/policy.md",
      summary: "Authentication policy reviewed for 2026 Q2."
    });

    const before = await validateEvidence(dir, { public: true });
    assert.equal(before.valid, true);
    assert.match(before.warnings.join("\n"), /candidate requirement mapping but no review decision/);

    await reviewEvidence(dir, {
      evidenceId: "ev_manual_auth_policy_2026_q2",
      requirementId: "ISMS-P-2.5.3.authentication-policy",
      decision: "accepted",
      rationale: "Control owner confirmed the policy.",
      privateEvidencePath: "evidence/private/ISMS-P-2.5.3/policy.md"
    });

    const after = await validateEvidence(dir, { public: true });
    assert.equal(after.valid, true);
    assert.doesNotMatch(after.issues.join("\n"), /private_evidence_path/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run integration tests**

Run:

```bash
npm run build
node --test dist/test/commands/evidence.test.js dist/test/commands/report.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit Task 4**

```bash
git add test/commands/evidence.test.ts test/commands/report.test.ts
git commit -m "test: cover manual evidence review flow"
```

## Task 5: Update Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/security-model.md`

- [ ] **Step 1: Add README example**

In `README.md`, add this section near the private evidence workflow:

````md
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
````

- [ ] **Step 2: Update security model**

In `docs/security-model.md`, add:

```md
`isms-agent evidence add` registers existing private operating evidence as public-safe metadata. The command requires `--private-evidence evidence/private/...` to exist, but it does not store that path in `evidence/index.jsonl`. The private path is recorded only in an accepted review overlay, and public report/export paths omit it.
```

- [ ] **Step 3: Run docs sanity checks**

Run:

```bash
rg -n "evidence add|private-evidence|needs_review" README.md docs/security-model.md
git diff --check README.md docs/security-model.md
```

Expected: `rg` finds the new documentation and `git diff --check` prints no output.

- [ ] **Step 4: Commit Task 5**

```bash
git add README.md docs/security-model.md
git commit -m "docs: document manual evidence registration"
```

## Task 6: Final Verification and Dogfood

**Files:**
- No source changes expected unless verification finds a bug.

- [ ] **Step 1: Run full test suite**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Run type check**

Run:

```bash
npm run check
```

Expected: no TypeScript errors.

- [ ] **Step 3: Run whitespace check**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 4: Dogfood manual evidence add in a temporary workspace**

Run:

```bash
repo="$(pwd)"
tmpdir="$(mktemp -d)"
mkdir -p "$tmpdir/evidence/private/ISMS-P-2.5.3/authentication-policy"
printf '# Authentication policy\n\nReviewed for dogfood.\n' > "$tmpdir/evidence/private/ISMS-P-2.5.3/authentication-policy/2026-Q2.md"
cd "$tmpdir"
node "$repo/dist/cli.js" evidence add \
  --id ev_manual_auth_policy_2026_q2 \
  --title "Authentication policy 2026 Q2" \
  --type policy_document \
  --classification internal \
  --supports ISMS-P-2.5.3.authentication-policy \
  --private-evidence evidence/private/ISMS-P-2.5.3/authentication-policy/2026-Q2.md \
  --summary "Authentication policy reviewed for 2026 Q2." \
  --metadata owner=security
node "$repo/dist/cli.js" evidence validate --public
cd "$repo"
rm -rf "$tmpdir"
```

Expected:

- `evidence add` exits 0 and prints JSON with `item.lifecycle_status: "needs_review"`.
- `evidence/index.jsonl` exists.
- `evidence/index.jsonl` does not contain `evidence/private`.
- `evidence validate --public` exits 0.

- [ ] **Step 5: Validate current ISMS-P workspace**

Run from the repo root:

```bash
node dist/cli.js pack validate packs/isms-p-core-v0
node dist/cli.js evidence validate --public
node dist/cli.js report --public
```

Expected:

- pack validation remains valid,
- public evidence validation remains valid,
- public reports generate successfully.

- [ ] **Step 6: Final commit if verification fixes were needed**

If verification required code fixes:

```bash
git add src/commands/evidence.ts src/cli.ts test/commands/evidence.test.ts test/commands/report.test.ts README.md docs/security-model.md
git commit -m "fix: stabilize manual evidence add flow"
```

If no fixes were needed, do not create an empty commit.

## Implementation Notes

- Do not store `privateEvidencePath` or `evidence/private/...` in `EvidenceItem`.
- Do not change `reviewEvidence()` semantics except for sharing private path resolution.
- Do not allow `evidence add` to create files.
- Do not allow `evidence add` to write accepted evidence.
- Keep public export behavior unchanged: only `public_sample` evidence is exported.
- Keep `evidence index` preserving non-scan evidence. Manual evidence has `origin: "manual"`, so it must survive scanner re-indexing.

## Spec Coverage Review

- Registration-only scope: Task 2 and Task 3.
- Existing private path required: Task 1 and Task 2.
- No private path in index: Task 1 and Task 2.
- Duplicate handling: Task 1 and Task 2.
- Content hashing: Task 2.
- Metadata safety: Task 1 and Task 2.
- CLI shape: Task 3.
- Reports and review semantics: Task 4.
- Documentation: Task 5.
- Verification: Task 6.
