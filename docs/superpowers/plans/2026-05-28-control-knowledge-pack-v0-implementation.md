# Control Knowledge Pack v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a three-control OpenKB-derived ISMS-P control knowledge pack that makes reports and `ask-context` more specific without making analyzer judgments more aggressive.

**Architecture:** Keep the pack as static JSON under `packs/isms-p-core-v0/` and validate it with tests before adding a loader command. Extend control and analysis schemas with optional pack metadata so reports can explain deleted or residual-risk controls while existing analyzer logic continues to use the base control fields.

**Tech Stack:** Node.js 22+, TypeScript, Node built-in `node:test`, existing file-based CLI workspace, no new runtime dependencies.

---

## Scope Check

This plan implements the pack itself and the minimum runtime metadata plumbing needed to render it safely. It does not build a full pack registry or remote update system.

Implemented in this plan:

1. Optional pack metadata schema.
2. `packs/isms-p-core-v0` static pack files.
3. Tests that validate OpenKB-relative provenance and public-safety rules.
4. Report and ask-context propagation of deleted-control metadata.
5. README usage for manually copying pack controls into a workspace.

Deferred:

1. `isms-agent pack install`.
2. Remote pack update checks.
3. Full official-source drift pipeline.
4. All 101 ISMS-P controls.

## File Structure

```text
packs/isms-p-core-v0/pack.json
packs/isms-p-core-v0/sources/source-manifest.json
packs/isms-p-core-v0/controls/ISMS-P-2.5.3.json
packs/isms-p-core-v0/controls/ISMS-P-2.5.6.json
packs/isms-p-core-v0/controls/ISMS-P-2.10.2.json
src/schemas/control.ts
src/schemas/analysis.ts
src/analyzer/gap.ts
src/reports/control-gap-report.ts
src/reports/evidence-map.ts
src/reports/backlog.ts
src/ask/context-builder.ts
test/packs/isms-p-core-v0.test.ts
test/reports/report.test.ts
test/commands/ask-context.test.ts
README.md
```

Responsibilities:

- `packs/isms-p-core-v0/`: public static pack generated from OpenKB-derived knowledge.
- `src/schemas/control.ts`: optional metadata types for pack lineage and effective status.
- `src/schemas/analysis.ts`: optional metadata copy exposed to reports and ask-context.
- `src/analyzer/gap.ts`: carry metadata from controls to analysis results without changing judgment logic.
- `src/reports/*`: render deleted residual-risk controls without normal gap wording.
- `src/ask/context-builder.ts`: include deleted-control facts when relevant.
- `test/packs/isms-p-core-v0.test.ts`: quality gates for pack completeness and public-safety.

## Task 1: Add Pack Metadata Types and Propagation

**Files:**
- Modify: `src/schemas/control.ts`
- Modify: `src/schemas/analysis.ts`
- Modify: `src/analyzer/gap.ts`
- Test: `test/analyzer/gap.test.ts`

- [ ] **Step 1: Write the failing metadata propagation test**

Append this test to `test/analyzer/gap.test.ts`:

```ts
test("analysis preserves optional pack metadata without changing conservative judgment", () => {
  const [result] = analyzeControls([
    control({
      control_id: "ISMS-P-2.5.6",
      title: "접근권한 검토",
      observable_signals: ["access review"],
      required_operating_practices: ["deleted-control decision review"],
      required_evidence: ["residual risk review record"],
      pack: {
        name: "isms-p-core-v0",
        source_of_truth: "openkb",
        openkb_control_id: "ISMS-P-2.5.6",
        effective_status: "deleted_residual_risk",
        review_status: "needs_human_review",
        source_confidence: "ocr_derived"
      }
    })
  ], []);

  assert.equal(result?.status, "needs_confirmation");
  assert.equal(result?.pack?.effective_status, "deleted_residual_risk");
  assert.equal(result?.pack?.source_of_truth, "openkb");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm run build
node --test dist/test/analyzer/gap.test.js
```

Expected: TypeScript build fails because `ControlKnowledge` and `ControlAnalysisResult` do not define `pack`.

- [ ] **Step 3: Add metadata types**

Modify `src/schemas/control.ts`:

```ts
export type AutomationPotential = "none" | "partial" | "high";

export type PackEffectiveStatus = "active" | "deleted_residual_risk";

export type PackReviewStatus = "needs_human_review" | "reviewed";

export type PackSourceConfidence = "ocr_derived" | "official_verified" | "human_curated";

export interface ControlPackMetadata {
  name: string;
  source_of_truth: "openkb";
  openkb_control_id: string;
  effective_status: PackEffectiveStatus;
  review_status: PackReviewStatus;
  source_confidence: PackSourceConfidence;
}

export interface SourceRef {
  sourcePath: string;
  sha256: string;
  excerpt?: string;
}

export interface ControlKnowledge {
  control_id: string;
  title: string;
  domain: string;
  category: string;
  requirement: string;
  intent: string;
  applicability_questions: string[];
  observable_signals: string[];
  required_operating_practices: string[];
  required_evidence: string[];
  common_defects: string[];
  automation_potential: AutomationPotential;
  human_review_required: boolean;
  source_refs: SourceRef[];
  pack?: ControlPackMetadata;
}
```

Modify `src/schemas/analysis.ts`:

```ts
import type { ControlPackMetadata, SourceRef } from "./control.js";

export type ControlStatus = "satisfied" | "partial" | "gap" | "not_applicable" | "needs_confirmation";

export type Confidence = "low" | "medium" | "high";

export type JudgmentBasis = "observed" | "document-backed" | "inferred" | "user-confirmed";

export interface ControlAnalysisResult {
  control_id: string;
  title: string;
  status: ControlStatus;
  observed_evidence: string[];
  missing: string[];
  recommended_actions: string[];
  required_evidence: string[];
  confidence: Confidence;
  judgment_basis: JudgmentBasis;
  source_refs: SourceRef[];
  pack?: ControlPackMetadata;
}
```

- [ ] **Step 4: Propagate metadata in analyzer result**

Modify the return value in `src/analyzer/gap.ts` inside `result()`:

```ts
  return {
    control_id: control.control_id,
    title: control.title,
    required_evidence: control.required_evidence,
    source_refs: control.source_refs,
    pack: control.pack,
    ...analysis
  };
```

- [ ] **Step 5: Run the focused test**

Run:

```bash
npm run build
node --test dist/test/analyzer/gap.test.js
```

Expected: analyzer tests pass and the new metadata test passes.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/schemas/control.ts src/schemas/analysis.ts src/analyzer/gap.ts test/analyzer/gap.test.ts
git commit -m "feat: carry control pack metadata"
```

## Task 2: Add the OpenKB-Derived Pack Files

**Files:**
- Create: `packs/isms-p-core-v0/pack.json`
- Create: `packs/isms-p-core-v0/sources/source-manifest.json`
- Create: `packs/isms-p-core-v0/controls/ISMS-P-2.5.3.json`
- Create: `packs/isms-p-core-v0/controls/ISMS-P-2.5.6.json`
- Create: `packs/isms-p-core-v0/controls/ISMS-P-2.10.2.json`
- Test: `test/packs/isms-p-core-v0.test.ts`

- [ ] **Step 1: Write the failing pack validation test**

Create `test/packs/isms-p-core-v0.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import type { ControlKnowledge } from "../../src/schemas/control.js";

const PACK_ROOT = join(process.cwd(), "packs", "isms-p-core-v0");

test("isms-p-core-v0 pack has the expected OpenKB controls", async () => {
  const names = (await readdir(join(PACK_ROOT, "controls"))).filter((name) => name.endsWith(".json")).sort();

  assert.deepEqual(names, [
    "ISMS-P-2.10.2.json",
    "ISMS-P-2.5.3.json",
    "ISMS-P-2.5.6.json"
  ]);

  const controls = await Promise.all(names.map(async (name) => {
    return JSON.parse(await readFile(join(PACK_ROOT, "controls", name), "utf8")) as ControlKnowledge;
  }));

  assert.deepEqual(controls.map((control) => control.control_id).sort(), [
    "ISMS-P-2.10.2",
    "ISMS-P-2.5.3",
    "ISMS-P-2.5.6"
  ]);
  assert.equal(controls.every((control) => control.pack?.source_of_truth === "openkb"), true);
});

test("active pack controls have analyzer-useful fields", async () => {
  const controls = await loadPackControls();
  const active = controls.filter((control) => control.pack?.effective_status === "active");

  assert.equal(active.length, 2);
  for (const control of active) {
    assert.ok(control.observable_signals.length >= 5, `${control.control_id} observable_signals`);
    assert.ok(control.required_operating_practices.length >= 3, `${control.control_id} operating practices`);
    assert.ok(control.required_evidence.length >= 3, `${control.control_id} required evidence`);
    assert.ok(control.common_defects.length >= 3, `${control.control_id} common defects`);
  }
});

test("deleted access review control is modeled as residual risk", async () => {
  const controls = await loadPackControls();
  const accessReview = controls.find((control) => control.control_id === "ISMS-P-2.5.6");

  assert.equal(accessReview?.pack?.effective_status, "deleted_residual_risk");
  assert.match(accessReview?.intent ?? "", /deleted/i);
  assert.ok(accessReview?.required_evidence.includes("deleted-control applicability note"));
  assert.ok(accessReview?.required_operating_practices.includes("residual access-review risk assessment"));
});

test("public pack files avoid private absolute paths and sensitive tokens", async () => {
  const files = [
    "pack.json",
    "sources/source-manifest.json",
    "controls/ISMS-P-2.5.3.json",
    "controls/ISMS-P-2.5.6.json",
    "controls/ISMS-P-2.10.2.json"
  ];

  for (const file of files) {
    const content = await readFile(join(PACK_ROOT, file), "utf8");
    assert.doesNotMatch(content, /\/Users\//);
    assert.doesNotMatch(content, /apps\/evaluation/);
    assert.doesNotMatch(content, /evaluate\.club asset map/);
    assert.doesNotMatch(content, /token|secret|api[_-]?key/i);
  }
});

async function loadPackControls(): Promise<ControlKnowledge[]> {
  const names = (await readdir(join(PACK_ROOT, "controls"))).filter((name) => name.endsWith(".json"));
  return Promise.all(names.map(async (name) => {
    return JSON.parse(await readFile(join(PACK_ROOT, "controls", name), "utf8")) as ControlKnowledge;
  }));
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm run build
node --test dist/test/packs/isms-p-core-v0.test.js
```

Expected: test fails because `packs/isms-p-core-v0` does not exist.

- [ ] **Step 3: Add `pack.json`**

Create `packs/isms-p-core-v0/pack.json`:

```json
{
  "schemaVersion": 1,
  "name": "isms-p-core-v0",
  "version": "0.1.0",
  "sourceOfTruth": "openkb",
  "sourceRootKind": "openkb-relative",
  "controlCount": 3,
  "controls": [
    "ISMS-P-2.5.3",
    "ISMS-P-2.5.6",
    "ISMS-P-2.10.2"
  ],
  "reviewStatus": "needs_human_review",
  "sourceConfidence": "ocr_derived",
  "publicSafety": {
    "containsPrivateServicePaths": false,
    "containsCustomerData": false,
    "containsSensitiveCredentials": false
  }
}
```

- [ ] **Step 4: Add `source-manifest.json`**

Create `packs/isms-p-core-v0/sources/source-manifest.json`:

```json
{
  "schemaVersion": 1,
  "sourceOfTruth": "openkb",
  "openkbRoot": "09_보안_ISMS-P_openkb",
  "officialFreshnessReference": {
    "publisher": "KISA",
    "title": "ISMS-P 세부점검항목 공지('23.10.31)",
    "url": "https://isms.kisa.or.kr/main/ispims/notice/?boardId=bbs_0000000000000014&cntId=19&mode=view",
    "publishedAt": "2023-10-31"
  },
  "openkbSources": [
    "raw/legal/7의2_ISMS-P_인증기준_항목_목록.jsonl",
    "compiled/controls/annex_7_2_mapping.jsonl",
    "compiled/citations/source_claims.jsonl",
    "compiled/evidence/evidence_requirements.jsonl",
    "wiki/controls/2_보호대책_요구사항/ISMS-P-2.5.3_사용자_인증.md",
    "wiki/controls/2_보호대책_요구사항/ISMS-P-2.5.6_접근권한_검토.md",
    "wiki/controls/2_보호대책_요구사항/ISMS-P-2.10.2_클라우드_보안.md"
  ],
  "excludedPrivateOverlayKinds": [
    "overlays/evaluate-club/assets",
    "overlays/evaluate-club/gaps",
    "overlays/evaluate-club/evidence"
  ]
}
```

- [ ] **Step 5: Add `ISMS-P-2.5.3.json`**

Create `packs/isms-p-core-v0/controls/ISMS-P-2.5.3.json`:

```json
{
  "schemaVersion": 1,
  "control_id": "ISMS-P-2.5.3",
  "title": "사용자 인증",
  "domain": "보호대책 요구사항",
  "category": "인증 및 권한관리",
  "requirement": "정보시스템과 중요정보 접근은 안전한 인증 절차와 필요 시 강화된 인증 방식을 통해 통제되어야 한다.",
  "intent": "Confirm that important systems and sensitive information are protected by safe authentication procedures, stronger authentication where required, and reviewed authentication operations.",
  "applicability_questions": [
    "Does the service have administrator, operator, customer, evaluator, or machine accounts?",
    "Can any important system or personal information be accessed over a network?",
    "Are privileged users or external access paths present?"
  ],
  "observable_signals": [
    "mfa",
    "two-factor",
    "session timeout",
    "login failure limit",
    "admin authentication",
    "oauth",
    "auth route",
    "authentication test"
  ],
  "required_operating_practices": [
    "authentication policy ownership and review cycle",
    "authentication setting change approval",
    "privileged or administrator MFA review",
    "login failure and abnormal authentication review",
    "authentication exception approval"
  ],
  "required_evidence": [
    "user authentication policy or procedure",
    "MFA and session configuration record",
    "authentication setting change approval record",
    "periodic authentication control review record",
    "abnormal login or failed-login review record"
  ],
  "common_defects": [
    "MFA exists for code paths but no owner or review cycle is documented",
    "session policy exists but is not tied to a formal control owner",
    "administrator authentication differs from normal user authentication but is not reviewed",
    "authentication exceptions are handled informally"
  ],
  "automation_potential": "partial",
  "human_review_required": true,
  "source_refs": [
    {
      "sourcePath": "raw/legal/7의2_ISMS-P_인증기준_항목_목록.jsonl",
      "sha256": "openkb-managed",
      "excerpt": "ISMS-P-2.5.3 사용자 인증"
    },
    {
      "sourcePath": "compiled/citations/source_claims.jsonl",
      "sha256": "openkb-managed",
      "excerpt": "CLM-2.5.3"
    }
  ],
  "pack": {
    "name": "isms-p-core-v0",
    "source_of_truth": "openkb",
    "openkb_control_id": "ISMS-P-2.5.3",
    "effective_status": "active",
    "review_status": "needs_human_review",
    "source_confidence": "ocr_derived"
  }
}
```

- [ ] **Step 6: Add `ISMS-P-2.5.6.json`**

Create `packs/isms-p-core-v0/controls/ISMS-P-2.5.6.json`:

```json
{
  "schemaVersion": 1,
  "control_id": "ISMS-P-2.5.6",
  "title": "접근권한 검토",
  "domain": "보호대책 요구사항",
  "category": "인증 및 권한관리",
  "requirement": "OpenKB marks this control as deleted; preserve residual-risk traceability rather than creating a normal missing-control gap.",
  "intent": "Preserve traceability that the old access review control was deleted while confirming whether access-review duties remain through other controls, contracts, privacy obligations, or customer security requirements.",
  "applicability_questions": [
    "Does the user still need to answer legacy or customer questions about access review?",
    "Do contracts, privacy obligations, or surviving access-control requirements still require periodic role review?",
    "Has a human owner confirmed how the deleted control maps to current controls?"
  ],
  "observable_signals": [
    "access review",
    "permission review",
    "role review",
    "admin role",
    "organization member",
    "deleted control",
    "residual risk"
  ],
  "required_operating_practices": [
    "deleted-control decision review",
    "residual access-review risk assessment",
    "mapping to surviving controls or contractual requirements",
    "human confirmation before treating the item as not applicable"
  ],
  "required_evidence": [
    "deleted-control applicability note",
    "residual risk review record",
    "legal or contractual access-review requirement check",
    "mapping record to active access control requirements"
  ],
  "common_defects": [
    "treating the deleted control as if no access review is needed anywhere",
    "creating a normal remediation gap from a deleted control",
    "losing the historical mapping and confusing users who search for access review"
  ],
  "automation_potential": "none",
  "human_review_required": true,
  "source_refs": [
    {
      "sourcePath": "compiled/controls/annex_7_2_mapping.jsonl",
      "sha256": "openkb-managed",
      "excerpt": "ISMS-P-2.5.6 접근권한 검토 status 삭제"
    },
    {
      "sourcePath": "compiled/citations/source_claims.jsonl",
      "sha256": "openkb-managed",
      "excerpt": "CLM-2.5.6"
    }
  ],
  "pack": {
    "name": "isms-p-core-v0",
    "source_of_truth": "openkb",
    "openkb_control_id": "ISMS-P-2.5.6",
    "effective_status": "deleted_residual_risk",
    "review_status": "needs_human_review",
    "source_confidence": "ocr_derived"
  }
}
```

- [ ] **Step 7: Add `ISMS-P-2.10.2.json`**

Create `packs/isms-p-core-v0/controls/ISMS-P-2.10.2.json`:

```json
{
  "schemaVersion": 1,
  "control_id": "ISMS-P-2.10.2",
  "title": "클라우드 보안",
  "domain": "보호대책 요구사항",
  "category": "시스템 및 서비스 보안관리",
  "requirement": "Cloud service use must define responsibility, secure configuration, restricted administrator access, monitoring, and periodic review to reduce unauthorized access or configuration-error exposure.",
  "intent": "Confirm that cloud use has defined responsibility, secure configuration, restricted administrator access, monitoring, and periodic review.",
  "applicability_questions": [
    "Does the service use Cloudflare, Vercel, managed storage, workers, queues, or other cloud services?",
    "Can cloud administrators change security-sensitive settings?",
    "Are cloud security settings reviewed after changes or on a recurring cycle?"
  ],
  "observable_signals": [
    "cloudflare",
    "worker",
    "r2",
    "queue",
    "binding",
    "tls",
    "waf",
    "dns",
    "vercel project",
    "deployment protection",
    "cloud administrator",
    "cloud setting review"
  ],
  "required_operating_practices": [
    "cloud responsibility and role definition",
    "cloud security baseline and change approval",
    "administrator privilege minimization and MFA",
    "cloud setting monitoring",
    "periodic cloud security review and follow-up tracking"
  ],
  "required_evidence": [
    "cloud responsibility matrix or policy",
    "cloud security baseline",
    "Cloudflare or Vercel configuration export",
    "cloud administrator access review record",
    "cloud setting change approval record",
    "periodic cloud security review record"
  ],
  "common_defects": [
    "cloud resources exist but responsibility boundaries are not documented",
    "settings are captured once but not reviewed periodically",
    "administrator roles are not separated from deployment roles",
    "binding names exist but rotation and approval evidence is missing"
  ],
  "automation_potential": "partial",
  "human_review_required": true,
  "source_refs": [
    {
      "sourcePath": "raw/legal/7의2_ISMS-P_인증기준_항목_목록.jsonl",
      "sha256": "openkb-managed",
      "excerpt": "ISMS-P-2.10.2 클라우드 보안"
    },
    {
      "sourcePath": "compiled/evidence/evidence_requirements.jsonl",
      "sha256": "openkb-managed",
      "excerpt": "EV-ISMS-P-2.10.2"
    }
  ],
  "pack": {
    "name": "isms-p-core-v0",
    "source_of_truth": "openkb",
    "openkb_control_id": "ISMS-P-2.10.2",
    "effective_status": "active",
    "review_status": "needs_human_review",
    "source_confidence": "ocr_derived"
  }
}
```

- [ ] **Step 8: Run pack tests**

Run:

```bash
npm run build
node --test dist/test/packs/isms-p-core-v0.test.js
```

Expected: all pack validation tests pass.

- [ ] **Step 9: Commit**

Run:

```bash
git add packs/isms-p-core-v0 test/packs/isms-p-core-v0.test.ts
git commit -m "feat: add ISMS-P core knowledge pack v0"
```

## Task 3: Render Deleted Residual-Risk Controls Safely

**Files:**
- Modify: `src/reports/control-gap-report.ts`
- Modify: `src/reports/evidence-map.ts`
- Modify: `src/reports/backlog.ts`
- Test: `test/reports/report.test.ts`

- [ ] **Step 1: Write failing report tests**

Append to `test/reports/report.test.ts`:

```ts
test("reports explain deleted residual-risk controls without normal gap wording", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-report-deleted-control-"));
  try {
    await mkdir(join(dir, "controls"), { recursive: true });
    await mkdir(join(dir, "scans"), { recursive: true });

    await writeFile(join(dir, "controls", "ISMS-P-2.5.6.json"), stringifyJson(control({
      control_id: "ISMS-P-2.5.6",
      title: "접근권한 검토",
      observable_signals: ["access review"],
      required_operating_practices: ["residual access-review risk assessment"],
      required_evidence: ["deleted-control applicability note"],
      pack: {
        name: "isms-p-core-v0",
        source_of_truth: "openkb",
        openkb_control_id: "ISMS-P-2.5.6",
        effective_status: "deleted_residual_risk",
        review_status: "needs_human_review",
        source_confidence: "ocr_derived"
      }
    })));
    await writeFile(join(dir, "scans", "scan-2026-05-28T00-00-00-000Z.json"), stringifyJson(scanResult({ signals: [] })));

    const result = await generateReports(dir);
    const controlGap = await readFile(result.outputPaths.controlGapReport, "utf8");
    const evidenceMap = await readFile(result.outputPaths.evidenceMap, "utf8");
    const backlog = await readFile(result.outputPaths.backlog, "utf8");

    assert.match(controlGap, /Deleted residual-risk control/);
    assert.match(controlGap, /OpenKB marks this control as deleted/);
    assert.match(evidenceMap, /Deleted control residual-risk review/);
    assert.match(backlog, /Review residual risk for deleted control ISMS-P-2\.5\.6 접근권한 검토/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm run build
node --test dist/test/reports/report.test.js
```

Expected: focused report test fails because reports do not mention deleted residual-risk controls.

- [ ] **Step 3: Add metadata helper functions**

In each report module that needs it, use this predicate:

```ts
function isDeletedResidualRisk(result: ControlAnalysisResult): boolean {
  return result.pack?.effective_status === "deleted_residual_risk";
}
```

- [ ] **Step 4: Update control gap report rendering**

In `src/reports/control-gap-report.ts`, insert this line after basis when the predicate is true:

```ts
isDeletedResidualRisk(result)
  ? "**Pack note:** Deleted residual-risk control. OpenKB marks this control as deleted; review residual obligations before treating it as not applicable."
  : undefined
```

Filter undefined values before joining:

```ts
const sections = sorted.map((result) => [
  `## ${result.control_id} ${result.title}`,
  `**Status:** ${result.status}`,
  `**Confidence:** ${result.confidence}`,
  `**Basis:** ${result.judgment_basis}`,
  isDeletedResidualRisk(result)
    ? "**Pack note:** Deleted residual-risk control. OpenKB marks this control as deleted; review residual obligations before treating it as not applicable."
    : undefined,
  "**Observed candidate evidence:**",
  markdownList(result.observed_evidence, "No candidate evidence observed."),
  "**Missing items:**",
  markdownList(result.missing, "No missing items identified."),
  "**Recommended actions:**",
  markdownList(result.recommended_actions, "No recommended actions generated."),
  "**Required candidate evidence:**",
  markdownList(result.required_evidence, "No required evidence recorded."),
  "**Source refs:**",
  sourceRefList(result.source_refs)
].filter((line): line is string => typeof line === "string").join("\n\n"));
```

- [ ] **Step 5: Update evidence map rendering**

In `src/reports/evidence-map.ts`, before `not_applicable` handling:

```ts
if (isDeletedResidualRisk(result)) {
  return [[
    `${result.control_id} ${result.title}`,
    "Deleted control residual-risk review",
    "OpenKB source mapping, applicability note, residual risk review record",
    "not confirmed",
    "not a normal active-control gap",
    "Confirm residual legal, contractual, or surviving-control obligations."
  ]];
}
```

- [ ] **Step 6: Update backlog rendering**

In `src/reports/backlog.ts`, before normal `needs_confirmation` handling:

```ts
if (isDeletedResidualRisk(result)) {
  return [{
    horizon: "this week",
    task: `Review residual risk for deleted control ${result.control_id} ${result.title}`,
    status: result.status,
    reason: "OpenKB marks this control as deleted; confirm whether legal, contractual, or surviving-control obligations remain.",
    controlIds: [result.control_id],
    owner: "security owner with compliance owner",
    priority: "medium",
    expectedEvidence: "Deleted-control applicability note and residual risk review record.",
    humanApproval: "Required before treating the control as not applicable."
  }];
}
```

- [ ] **Step 7: Run focused report tests**

Run:

```bash
npm run build
node --test dist/test/reports/report.test.js
```

Expected: report tests pass.

- [ ] **Step 8: Commit**

Run:

```bash
git add src/reports/control-gap-report.ts src/reports/evidence-map.ts src/reports/backlog.ts test/reports/report.test.ts
git commit -m "feat: explain deleted residual-risk controls"
```

## Task 4: Prove Pack Controls Improve Ask Context

**Files:**
- Modify: `test/commands/ask-context.test.ts`
- Modify: `src/ask/context-builder.ts`

- [ ] **Step 1: Write a failing ask-context test**

Append this test to `test/commands/ask-context.test.ts`:

```ts
test("ask-context exposes pack metadata for deleted residual-risk controls", async () => {
  const dir = await workspace();
  try {
    await writeFile(join(dir, "controls", "ISMS-P-2.5.6.json"), stringifyJson(control({
      control_id: "ISMS-P-2.5.6",
      title: "접근권한 검토",
      observable_signals: ["access review"],
      required_operating_practices: ["residual access-review risk assessment"],
      required_evidence: ["deleted-control applicability note"],
      pack: {
        name: "isms-p-core-v0",
        source_of_truth: "openkb",
        openkb_control_id: "ISMS-P-2.5.6",
        effective_status: "deleted_residual_risk",
        review_status: "needs_human_review",
        source_confidence: "ocr_derived"
      }
    })));

    const context = await buildAskContext(dir, "ISMS-P-2.5.6 접근권한 검토는 어떻게 봐야 해?");
    assert.equal(context.relevantControls[0]?.pack?.effective_status, "deleted_residual_risk");
    assert.match(context.facts.join("\n"), /deleted residual-risk control/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm run build
node --test dist/test/commands/ask-context.test.js
```

Expected: test fails because `facts` do not include deleted-control wording.

- [ ] **Step 3: Add deleted-control facts**

In `src/ask/context-builder.ts`, inside `factsFor`, after the status fact:

```ts
if (control.pack?.effective_status === "deleted_residual_risk") {
  facts.push(`${control.control_id} is a deleted residual-risk control from the OpenKB source of truth.`);
}
```

- [ ] **Step 4: Run focused ask-context tests**

Run:

```bash
npm run build
node --test dist/test/commands/ask-context.test.js
```

Expected: ask-context tests pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/ask/context-builder.ts test/commands/ask-context.test.ts
git commit -m "feat: expose pack metadata in ask context"
```

## Task 5: Document Manual Pack Usage and Verify End to End

**Files:**
- Modify: `README.md`
- Test: full project verification

- [ ] **Step 1: Update README**

Add a section after "Natural-Language Questions with Agents":

````md
## Control Knowledge Pack v0

The first curated pack is `packs/isms-p-core-v0`. It uses the local OpenKB ISMS-P workspace as the source of truth and includes three controls:

- `ISMS-P-2.5.3 사용자 인증`
- `ISMS-P-2.5.6 접근권한 검토`
- `ISMS-P-2.10.2 클라우드 보안`

Until `isms-agent pack install` exists, copy the controls into a workspace manually:

```bash
cp packs/isms-p-core-v0/controls/*.json /path/to/workspace/controls/
cd /path/to/workspace
isms-agent scan --local
isms-agent report
isms-agent ask-context "ISMS-P-2.10.2 클라우드 보안에서 부족한 증적은?"
```

`ISMS-P-2.5.6 접근권한 검토` is modeled as a deleted residual-risk control. The CLI should ask for residual-risk review, not treat it as a normal active-control gap.
````

- [ ] **Step 2: Run full verification**

Run:

```bash
npm test
npm run check
git diff --check
git diff --cached --check
```

Expected:

- `npm test` reports all tests passing.
- `npm run check` exits 0.
- both diff checks exit 0.

- [ ] **Step 3: Run local smoke with pack controls**

Run:

```bash
WORKSPACE="$(mktemp -d /private/tmp/isms-pack-v0-e2e-XXXXXX)"
node dist/cli.js init
```

The second command must run with `workdir` set to `$WORKSPACE`. Then copy pack controls:

```bash
cp packs/isms-p-core-v0/controls/*.json "$WORKSPACE/controls/"
```

Create two local operating documents in `$WORKSPACE/project/`:

```md
# Authentication Review

## MFA and session configuration record

Authentication setting change approval is documented for administrator MFA.
```

```md
# Cloud Security Review

## Cloud responsibility matrix or policy

Cloud setting change approval and periodic cloud security review are documented.
```

Run:

```bash
node /Users/jeean/Documents/ISMS-P\ AI\ Agent\ 구축/dist/cli.js scan --local
node /Users/jeean/Documents/ISMS-P\ AI\ Agent\ 구축/dist/cli.js report
node /Users/jeean/Documents/ISMS-P\ AI\ Agent\ 구축/dist/cli.js ask-context "ISMS-P-2.10.2 클라우드 보안 증적은?" --markdown
```

Expected:

- reports are generated,
- `ask-context` returns `ISMS-P-2.10.2 클라우드 보안`,
- missing items mention specific pack evidence terms instead of only `scanner coverage`,
- `ISMS-P-2.5.6` report language mentions deleted residual-risk control.

- [ ] **Step 4: Commit**

Run:

```bash
git add README.md
git commit -m "docs: document control knowledge pack usage"
```

## Self-Review

Spec coverage:

- OpenKB as source of truth: Task 2 pack metadata and source manifest.
- Three controls only: Task 2 test asserts exact control list.
- Deleted `ISMS-P-2.5.6` handling: Tasks 1, 3, and 4.
- Public-safety restrictions: Task 2 test scans pack files.
- Analyzer remains conservative: Task 1 asserts `needs_confirmation` remains unchanged.
- No pack loader dependency: README documents manual copy for now.

Plan wording scan:

- No banned incomplete-work markers or unnamed files remain.

Type consistency:

- `ControlPackMetadata` is defined once in `src/schemas/control.ts`.
- `ControlAnalysisResult.pack` reuses the same type.
- `deleted_residual_risk` is the single effective-status string used by tests, reports, and pack JSON.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-28-control-knowledge-pack-v0-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints.
