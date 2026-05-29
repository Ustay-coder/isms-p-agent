# Accepted Operating Evidence Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `accepted` evidence review decisions require a real local private operating evidence reference.

**Architecture:** Keep the workflow local-first. Extend the existing `evidence review` command with `--private-evidence`, store only a workspace-relative path in ignored review records, and add validator checks so accepted decisions cannot exist without a valid `evidence/private/` backing record.

**Tech Stack:** TypeScript, Node.js `node:test`, existing CLI parser, JSONL review records.

---

### Task 1: Review Record Contract

**Files:**
- Modify: `src/schemas/evidence.ts`
- Modify: `src/commands/evidence.ts`
- Modify: `src/cli.ts`
- Modify: `test/commands/evidence.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests that assert:

- accepted review without `privateEvidencePath` rejects,
- accepted review with missing private file rejects,
- accepted review with path outside `evidence/private/` rejects,
- accepted review with existing private file writes `private_evidence_path`,
- CLI accepts `--private-evidence` for accepted decisions.

- [ ] **Step 2: Implement type and command changes**

Add `private_evidence_path?: string` to `EvidenceReviewRecord`, add `privateEvidencePath?: string` to `EvidenceReviewOptions`, parse `--private-evidence`, and require it only for `decision: "accepted"`.

- [ ] **Step 3: Verify**

Run:

```bash
npm run build
node --test dist/test/commands/evidence.test.js
```

Expected: tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/schemas/evidence.ts src/commands/evidence.ts src/cli.ts test/commands/evidence.test.ts
git commit -m "feat: require private evidence for accepted reviews"
```

### Task 2: Validator and Public Output Guard

**Files:**
- Modify: `src/commands/evidence.ts`
- Modify: `test/commands/evidence.test.ts`
- Modify: `test/commands/report.test.ts`

- [ ] **Step 1: Write failing validation tests**

Add tests for accepted review records with missing, outside, or nonexistent `private_evidence_path`.

- [ ] **Step 2: Add validator logic**

Validate accepted review records independently of evidence item validation. Reject invalid private evidence references in both normal and public validation.

- [ ] **Step 3: Confirm public report redaction**

Add or update a report test proving `report --public` does not include `private_evidence_path` or the private filename.

- [ ] **Step 4: Verify**

Run:

```bash
npm test
npm run check
git diff --check
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/commands/evidence.ts test/commands/evidence.test.ts test/commands/report.test.ts
git commit -m "test: validate accepted evidence private references"
```

### Task 3: Documentation and Dogfood

**Files:**
- Modify: `README.md`
- Modify: `docs/security-model.md`
- Modify: `docs/evidence-templates/cloudflare/*.md`

- [ ] **Step 1: Update command examples**

Document `--private-evidence evidence/private/...` in accepted review examples.

- [ ] **Step 2: Run local dogfood**

Create a temporary private evidence file under `evidence/private/ISMS-P-2.10.2/security-review/`, create or reuse a manual evidence index row, run accepted review, validate public safety, and generate public reports.

- [ ] **Step 3: Remove local private dogfood files**

Remove any dogfood private evidence/review/report artifacts that should not be committed.

- [ ] **Step 4: Final gate**

Run:

```bash
npm test
npm run check
git diff --check
node dist/cli.js evidence validate --public
node dist/cli.js report --public
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/security-model.md docs/evidence-templates/cloudflare
git commit -m "docs: document accepted operating evidence workflow"
```

## Self-Review Mapping

- Accepted decisions require private operating evidence: Task 1.
- Invalid private references are rejected: Task 2.
- Public outputs do not expose private paths or rationale: Task 2 and Task 3.
- Cloudflare scanner bulk acceptance remains blocked: existing tests remain in Task 2 full suite.
- Local-first no-upload/no-commit boundary is preserved: Task 3.
