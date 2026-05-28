# OpenKB Pack Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `isms-agent pack generate` so maintainers can create deterministic draft Control Knowledge Packs from local OpenKB compiled/wiki inputs and immediately validate the generated output.

**Architecture:** Add a focused generator module that reads a local OpenKB root, parses JSONL compiled layers, derives conservative `ControlKnowledge` JSON, writes a pack directory, and then reuses the existing `validatePack()` quality gate. Keep OpenKB parsing, generation, and CLI argument parsing separate so tests can exercise the generator without spawning a process.

**Tech Stack:** Node.js 22+, TypeScript, Node built-in `node:test`, file-based JSON/JSONL fixtures, existing `validatePack()` function, no new runtime dependencies.

---

## Scope Check

This implementation builds the first useful generator slice only:

1. Parse fixture OpenKB files for active and deleted controls.
2. Generate `pack.json`, `sources/source-manifest.json`, and `controls/*.json`.
3. Preserve the current Source of Truth rule: direct sources are compiled/wiki only; `raw/legal/*` is cross-check only.
4. Add `isms-agent pack generate --openkb <dir> --pack <dir> --controls <ids>`.
5. Prove generated packs pass `validatePack()`.

This implementation does not add remote OpenKB downloads, OCR, LLM calls, official law lookups, or full all-control generation.

## File Structure

```text
src/commands/pack.ts
src/cli.ts
src/core/jsonl.ts
src/generator/openkb-pack.ts
src/generator/openkb-types.ts
test/commands/pack-generate.test.ts
test/generator/openkb-pack.test.ts
test/fixtures/openkb/compiled/controls/annex_7_2_mapping.jsonl
test/fixtures/openkb/compiled/citations/source_claims.jsonl
test/fixtures/openkb/compiled/evidence/evidence_requirements.jsonl
test/fixtures/openkb/raw/legal/7의2_ISMS-P_인증기준_항목_목록.jsonl
test/fixtures/openkb/wiki/controls/2_보호대책_요구사항/ISMS-P-2.5.3_사용자_인증.md
test/fixtures/openkb/wiki/controls/2_보호대책_요구사항/ISMS-P-2.5.6_접근권한_검토.md
README.md
```

Responsibilities:

- `src/core/jsonl.ts`: parse newline-delimited JSON files with useful path and line-number errors.
- `src/generator/openkb-types.ts`: local types for only the OpenKB fields the generator reads.
- `src/generator/openkb-pack.ts`: pure-ish generator: load OpenKB inputs, derive pack objects, write pack files.
- `src/commands/pack.ts`: expose `generatePackFromOpenKb()` through command-level function next to `validatePack()`.
- `src/cli.ts`: route `isms-agent pack generate` arguments.
- `test/fixtures/openkb/`: minimal stable OpenKB root for generator tests.
- `test/generator/openkb-pack.test.ts`: generator unit and integration tests.
- `test/commands/pack-generate.test.ts`: CLI behavior tests.
- `README.md`: document generator command and review gate.

## Task 1: Add JSONL Reader and OpenKB Fixture

**Files:**
- Create: `src/core/jsonl.ts`
- Create: `test/fixtures/openkb/compiled/controls/annex_7_2_mapping.jsonl`
- Create: `test/fixtures/openkb/compiled/citations/source_claims.jsonl`
- Create: `test/fixtures/openkb/compiled/evidence/evidence_requirements.jsonl`
- Create: `test/fixtures/openkb/raw/legal/7의2_ISMS-P_인증기준_항목_목록.jsonl`
- Create: `test/fixtures/openkb/wiki/controls/2_보호대책_요구사항/ISMS-P-2.5.3_사용자_인증.md`
- Create: `test/fixtures/openkb/wiki/controls/2_보호대책_요구사항/ISMS-P-2.5.6_접근권한_검토.md`
- Test: `test/generator/openkb-pack.test.ts`

- [ ] **Step 1: Write the failing JSONL reader test**

Create `test/generator/openkb-pack.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readJsonl } from "../../src/core/jsonl.js";

test("readJsonl parses non-empty JSONL records", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-jsonl-"));
  try {
    const path = join(dir, "records.jsonl");
    await writeFile(path, "{\"id\":\"a\"}\n\n{\"id\":\"b\"}\n");

    const records = await readJsonl<{ id: string }>(path);

    assert.deepEqual(records, [{ id: "a" }, { id: "b" }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readJsonl reports invalid JSON with file and line", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-jsonl-"));
  try {
    const path = join(dir, "broken.jsonl");
    await writeFile(path, "{\"id\":\"a\"}\n{\"id\":\n");

    await assert.rejects(readJsonl(path), /broken\.jsonl line 2 is not valid JSON/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
npm run build
node --test dist/test/generator/openkb-pack.test.js
```

Expected: TypeScript build fails with `Cannot find module '../../src/core/jsonl.js'`.

- [ ] **Step 3: Implement `readJsonl()`**

Create `src/core/jsonl.ts`:

```ts
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

export async function readJsonl<T>(path: string): Promise<T[]> {
  const content = await readFile(path, "utf8");
  const records: T[] = [];
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }

    try {
      records.push(JSON.parse(line) as T);
    } catch {
      throw new Error(`${basename(path)} line ${index + 1} is not valid JSON`);
    }
  }

  return records;
}
```

- [ ] **Step 4: Add fixture OpenKB files**

Create `test/fixtures/openkb/compiled/controls/annex_7_2_mapping.jsonl`:

```jsonl
{"control_id":"ISMS-P-2.5.3","control_name":"사용자 인증","part":"보호대책 요구사항","domain_id":"2.5","status":"유지","simplified_control_id":"ISMS-P-2.5.3","merged_into":null,"source_pages":[66,67,95,100,101,102]}
{"control_id":"ISMS-P-2.5.6","control_name":"접근권한 검토","part":"보호대책 요구사항","domain_id":"2.5","status":"삭제","simplified_control_id":null,"merged_into":null,"source_pages":[66,68,95,107,108,109]}
```

Create `test/fixtures/openkb/compiled/citations/source_claims.jsonl`:

```jsonl
{"annex_7_2_status":"유지","annex_7_3_status":"유지","claim_id":"CLM-2.5.3","claim_type":"control_requirement_source","confidence":"ocr_derived","control_id":"ISMS-P-2.5.3","control_name":"사용자 인증","effective_status":"유지","pages":[66,67,95,100,101,102],"quote_policy":"원문 장문은 raw/에만 보관하고 wiki에는 claim 참조만 둔다.","review_status":"needs_human_review","source_id":"google_document_ai_ocr","source_path":"raw/official/ocr/google_document_ai/2026_중소기업_ISMS-P_가이드북_google_document_ai_ocr.jsonl"}
{"annex_7_2_status":"삭제","annex_7_3_status":"삭제","claim_id":"CLM-2.5.6","claim_type":"control_requirement_source","confidence":"ocr_derived","control_id":"ISMS-P-2.5.6","control_name":"접근권한 검토","effective_status":"삭제","pages":[66,68,95,107,108,109],"quote_policy":"원문 장문은 raw/에만 보관하고 wiki에는 claim 참조만 둔다.","review_status":"needs_human_review","source_id":"google_document_ai_ocr","source_path":"raw/official/ocr/google_document_ai/2026_중소기업_ISMS-P_가이드북_google_document_ai_ocr.jsonl"}
```

Create `test/fixtures/openkb/compiled/evidence/evidence_requirements.jsonl`:

```jsonl
{"evidence_id":"EV-ISMS-P-2.5.3-001","control_id":"ISMS-P-2.5.3","control_name":"사용자 인증","part":"보호대책 요구사항","domain_id":"2.5","domain_name":"인증 및 권한관리","effective_status":"유지","annex_7_2_status":"유지","title":"사용자 인증 정책·절차 문서","evidence_type":"policy","owner_role":"engineering_owner","collection_method":"manual_document_review","refresh_cycle":"annual_or_on_change","retention_period":"3 years","source_system":"security operations records","current_status":"not_checked","automation_candidate":false,"required_for":["7의2"],"linked_assets":[],"acceptance_criteria":"사용자 인증 요구사항을 수행하는 책임자, 절차, 예외 처리, 검토 주기가 문서에 포함되어야 한다."}
{"evidence_id":"EV-ISMS-P-2.5.3-002","control_id":"ISMS-P-2.5.3","control_name":"사용자 인증","part":"보호대책 요구사항","domain_id":"2.5","domain_name":"인증 및 권한관리","effective_status":"유지","annex_7_2_status":"유지","title":"MFA 및 세션 인증 설정 근거","evidence_type":"system_config","owner_role":"engineering_owner","collection_method":"manual_or_system_export","refresh_cycle":"quarterly","retention_period":"3 years","source_system":"security operations records","current_status":"not_checked","automation_candidate":true,"required_for":["7의2"],"linked_assets":[],"acceptance_criteria":"관리자와 주요 사용자 인증 방식, MFA 적용 범위, 세션 만료 정책이 확인되어야 한다."}
{"evidence_id":"EV-ISMS-P-2.5.6-001","control_id":"ISMS-P-2.5.6","control_name":"접근권한 검토","part":"보호대책 요구사항","domain_id":"2.5","domain_name":"인증 및 권한관리","effective_status":"삭제","annex_7_2_status":"삭제","title":"접근권한 검토 삭제 판정 및 잔존 리스크 검토 기록","evidence_type":"risk_review","owner_role":"engineering_owner","collection_method":"manual_review","refresh_cycle":"on_change","retention_period":"3 years","source_system":"security operations records","current_status":"not_checked","automation_candidate":false,"required_for":["운영 리스크 검토"],"linked_assets":[],"acceptance_criteria":"해당 통제항목이 제외된 근거와 운영상 잔존 리스크가 기록되어야 한다."}
```

Create `test/fixtures/openkb/raw/legal/7의2_ISMS-P_인증기준_항목_목록.jsonl`:

```jsonl
{"control_id":"ISMS-P-2.4.3","source_control_id":"2.4.3","part":"2. 보호대책 요구사항","domain_id":"2.4.","domain_name":"인증 및 권한관리","control_name":"사용자 인증","detail":"정보시스템과 개인정보 및 중요정보에 대한 사용자의 접근은 안전한 인증절차와 필요에 따라 강화된 인증방식을 적용하여야 한다.","check_items":[{"check_id":"ISMS-P-2.4.3-C01","text":"안전한 사용자 인증 절차에 의해 통제하고 있는가?"}]}
{"control_id":"ISMS-P-2.5.3","source_control_id":"2.5.3","part":"2. 보호대책 요구사항","domain_id":"2.5.","domain_name":"접근통제","control_name":"원격접근 통제","detail":"원격접근을 허용하는 경우 보호대책을 수립 이행하여야 한다.","check_items":[{"check_id":"ISMS-P-2.5.3-C01","text":"원격운영 보완대책을 마련하고 있는가?"}]}
```

Create `test/fixtures/openkb/wiki/controls/2_보호대책_요구사항/ISMS-P-2.5.3_사용자_인증.md`:

```markdown
---
control_id: ISMS-P-2.5.3
control_name: 사용자 인증
source_claim_id: CLM-2.5.3
---

# ISMS-P-2.5.3 사용자 인증

정보시스템과 중요정보 접근은 안전한 인증 절차와 필요 시 강화된 인증 방식으로 통제되어야 한다.

## 운영 포인트

- 인증 정책 소유자와 검토 주기를 둔다.
- 관리자 MFA 적용 범위를 검토한다.
- 로그인 실패와 이상 인증 시도를 검토한다.
```

Create `test/fixtures/openkb/wiki/controls/2_보호대책_요구사항/ISMS-P-2.5.6_접근권한_검토.md`:

```markdown
---
control_id: ISMS-P-2.5.6
control_name: 접근권한 검토
source_claim_id: CLM-2.5.6
---

# ISMS-P-2.5.6 접근권한 검토

OpenKB는 이 항목을 삭제 상태로 표시한다. 삭제된 통제라도 잔존 리스크와 계약상 요구사항은 별도 검토한다.
```

- [ ] **Step 5: Run the focused test**

Run:

```bash
npm run build
node --test dist/test/generator/openkb-pack.test.js
```

Expected: both JSONL reader tests pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/core/jsonl.ts test/generator/openkb-pack.test.ts test/fixtures/openkb
git commit -m "test: add OpenKB generator fixtures"
```

## Task 2: Generate Pack Objects from OpenKB

**Files:**
- Create: `src/generator/openkb-types.ts`
- Create: `src/generator/openkb-pack.ts`
- Modify: `test/generator/openkb-pack.test.ts`

- [ ] **Step 1: Add failing generator test for active and deleted controls**

Append to `test/generator/openkb-pack.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { generatePackFromOpenKb } from "../../src/generator/openkb-pack.js";
import { validatePack } from "../../src/commands/pack.js";

test("generatePackFromOpenKb writes active and deleted residual-risk controls", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-pack-generate-"));
  try {
    const openkbRoot = join(process.cwd(), "test", "fixtures", "openkb");
    const packRoot = join(dir, "isms-p-generated-v0");

    const result = await generatePackFromOpenKb({
      openkbRoot,
      packRoot,
      packName: "isms-p-generated-v0",
      version: "0.1.0",
      controlIds: ["ISMS-P-2.5.3", "ISMS-P-2.5.6"]
    });

    assert.deepEqual(result.generatedControls, ["ISMS-P-2.5.3", "ISMS-P-2.5.6"]);

    const active = JSON.parse(await readFile(join(packRoot, "controls", "ISMS-P-2.5.3.json"), "utf8"));
    assert.equal(active.control_id, "ISMS-P-2.5.3");
    assert.equal(active.title, "사용자 인증");
    assert.equal(active.pack.effective_status, "active");
    assert.equal(active.pack.review_status, "needs_human_review");
    assert.ok(active.source_refs.some((sourceRef: { sourcePath: string }) => sourceRef.sourcePath === "compiled/controls/annex_7_2_mapping.jsonl"));
    assert.ok(active.source_refs.some((sourceRef: { sourcePath: string }) => sourceRef.sourcePath === "compiled/citations/source_claims.jsonl"));
    assert.ok(active.source_refs.every((sourceRef: { sourcePath: string }) => !sourceRef.sourcePath.startsWith("raw/legal/")));
    assert.deepEqual(active.required_evidence, [
      "사용자 인증 정책·절차 문서",
      "MFA 및 세션 인증 설정 근거"
    ]);

    const deleted = JSON.parse(await readFile(join(packRoot, "controls", "ISMS-P-2.5.6.json"), "utf8"));
    assert.equal(deleted.control_id, "ISMS-P-2.5.6");
    assert.equal(deleted.pack.effective_status, "deleted_residual_risk");
    assert.equal(deleted.human_review_required, true);
    assert.match(deleted.intent, /deleted/i);
    assert.ok(deleted.required_operating_practices.some((practice: string) => /residual|deleted/i.test(practice)));

    const validation = await validatePack(packRoot);
    assert.equal(validation.valid, true);
    assert.deepEqual(validation.issues, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
npm run build
node --test dist/test/generator/openkb-pack.test.js
```

Expected: TypeScript build fails with `Cannot find module '../../src/generator/openkb-pack.js'`.

- [ ] **Step 3: Add OpenKB generator types**

Create `src/generator/openkb-types.ts`:

```ts
export interface AnnexMappingRow {
  control_id: string;
  control_name: string;
  part: string;
  domain_id: string;
  status: "유지" | "삭제" | string;
  simplified_control_id: string | null;
  merged_into: string | null;
  source_pages: number[];
}

export interface SourceClaimRow {
  claim_id: string;
  control_id: string;
  control_name: string;
  confidence: "ocr_derived" | "official_verified" | "human_curated" | string;
  review_status: "needs_human_review" | "reviewed" | string;
  source_path: string;
  pages: number[];
}

export interface EvidenceRequirementRow {
  evidence_id: string;
  control_id: string;
  control_name: string;
  domain_name: string;
  title: string;
  evidence_type: string;
  automation_candidate: boolean;
  acceptance_criteria: string;
}

export interface RawLegalRow {
  control_id: string;
  source_control_id?: string;
  control_name: string;
}

export interface GeneratePackOptions {
  openkbRoot: string;
  packRoot: string;
  packName: string;
  version: string;
  controlIds: string[];
}

export interface GeneratePackResult {
  packRoot: string;
  generatedControls: string[];
}
```

- [ ] **Step 4: Implement generator**

Create `src/generator/openkb-pack.ts`:

```ts
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { stringifyJson } from "../core/json.js";
import { readJsonl } from "../core/jsonl.js";
import type { ControlKnowledge, PackEffectiveStatus, PackSourceConfidence } from "../schemas/control.js";
import type {
  AnnexMappingRow,
  EvidenceRequirementRow,
  GeneratePackOptions,
  GeneratePackResult,
  SourceClaimRow
} from "./openkb-types.js";

const ANNEX_7_2_PATH = "compiled/controls/annex_7_2_mapping.jsonl";
const SOURCE_CLAIMS_PATH = "compiled/citations/source_claims.jsonl";
const EVIDENCE_REQUIREMENTS_PATH = "compiled/evidence/evidence_requirements.jsonl";
const RAW_LEGAL_PROFILE_PATH = "raw/legal/7의2_ISMS-P_인증기준_항목_목록.jsonl";

export async function generatePackFromOpenKb(options: GeneratePackOptions): Promise<GeneratePackResult> {
  const annexRows = await readJsonl<AnnexMappingRow>(join(options.openkbRoot, ANNEX_7_2_PATH));
  const claimRows = await readJsonl<SourceClaimRow>(join(options.openkbRoot, SOURCE_CLAIMS_PATH));
  const evidenceRows = await readJsonl<EvidenceRequirementRow>(join(options.openkbRoot, EVIDENCE_REQUIREMENTS_PATH));
  const wikiFiles = await findWikiControlFiles(join(options.openkbRoot, "wiki", "controls"));

  const selectedControls = options.controlIds.map((controlId) => {
    const annex = annexRows.find((row) => row.control_id === controlId);
    if (!annex) {
      throw new Error(`OpenKB annex mapping is missing ${controlId}`);
    }
    return buildControl({
      packName: options.packName,
      annex,
      claim: claimRows.find((row) => row.control_id === controlId),
      evidence: evidenceRows.filter((row) => row.control_id === controlId),
      wikiPath: wikiFiles.find((path) => path.includes(`${controlId}_`)),
      openkbRoot: options.openkbRoot
    });
  });

  await mkdir(join(options.packRoot, "controls"), { recursive: true });
  await mkdir(join(options.packRoot, "sources"), { recursive: true });

  for (const control of selectedControls) {
    await writeFile(join(options.packRoot, "controls", `${control.control_id}.json`), stringifyJson(control));
  }

  await writeFile(join(options.packRoot, "pack.json"), stringifyJson({
    schemaVersion: 1,
    name: options.packName,
    version: options.version,
    sourceOfTruth: "openkb",
    sourceRootKind: "openkb-relative",
    controlCount: selectedControls.length,
    controls: selectedControls.map((control) => control.control_id),
    reviewStatus: "needs_human_review",
    sourceConfidence: "ocr_derived",
    publicSafety: {
      containsPrivateServicePaths: false,
      containsCustomerData: false,
      containsSensitiveCredentials: false
    }
  }));

  await writeFile(join(options.packRoot, "sources", "source-manifest.json"), stringifyJson({
    schemaVersion: 1,
    sourceOfTruth: "openkb",
    openkbRoot: "openkb-relative",
    openkbSources: [
      ANNEX_7_2_PATH,
      SOURCE_CLAIMS_PATH,
      EVIDENCE_REQUIREMENTS_PATH,
      ...selectedControls
        .flatMap((control) => control.source_refs.map((sourceRef) => sourceRef.sourcePath))
        .filter((sourcePath) => sourcePath.startsWith("wiki/"))
    ].filter((sourcePath, index, list) => list.indexOf(sourcePath) === index),
    sourceProfileReferences: [],
    knownSourceProfileConflicts: [],
    privateOverlaysIncluded: false
  }));

  return {
    packRoot: options.packRoot,
    generatedControls: selectedControls.map((control) => control.control_id)
  };
}

function buildControl(input: {
  packName: string;
  annex: AnnexMappingRow;
  claim?: SourceClaimRow;
  evidence: EvidenceRequirementRow[];
  wikiPath?: string;
  openkbRoot: string;
}): ControlKnowledge {
  const effectiveStatus = mapEffectiveStatus(input.annex.status);
  const evidenceTitles = input.evidence.map((row) => row.title);
  const wikiSourcePath = input.wikiPath ? normalizeOpenKbPath(input.openkbRoot, input.wikiPath) : undefined;

  return {
    schemaVersion: 1,
    control_id: input.annex.control_id,
    title: input.annex.control_name,
    domain: input.annex.part,
    category: input.evidence[0]?.domain_name ?? input.annex.domain_id,
    requirement: buildRequirement(input.annex, input.evidence),
    intent: buildIntent(input.annex, effectiveStatus),
    applicability_questions: buildApplicabilityQuestions(input.annex, effectiveStatus),
    observable_signals: buildObservableSignals(input.annex, input.evidence),
    required_operating_practices: buildOperatingPractices(input.annex, effectiveStatus),
    required_evidence: evidenceTitles.length > 0 ? evidenceTitles : [`${input.annex.control_name} 검토 기록`],
    common_defects: buildCommonDefects(input.annex, effectiveStatus),
    automation_potential: input.evidence.some((row) => row.automation_candidate) ? "partial" : "none",
    human_review_required: true,
    source_refs: [
      {
        sourcePath: ANNEX_7_2_PATH,
        sha256: "openkb-managed",
        excerpt: `${input.annex.control_id} ${input.annex.control_name} status ${input.annex.status}`
      },
      ...(input.claim ? [{
        sourcePath: SOURCE_CLAIMS_PATH,
        sha256: "openkb-managed",
        excerpt: input.claim.claim_id
      }] : []),
      ...(input.evidence.length > 0 ? [{
        sourcePath: EVIDENCE_REQUIREMENTS_PATH,
        sha256: "openkb-managed",
        excerpt: input.evidence.map((row) => row.evidence_id).join(", ")
      }] : []),
      ...(wikiSourcePath ? [{
        sourcePath: wikiSourcePath,
        sha256: "openkb-managed",
        excerpt: `${input.annex.control_id} ${input.annex.control_name}`
      }] : [])
    ],
    pack: {
      name: input.packName,
      source_of_truth: "openkb",
      openkb_control_id: input.annex.control_id,
      effective_status: effectiveStatus,
      review_status: "needs_human_review",
      source_confidence: mapSourceConfidence(input.claim?.confidence)
    }
  } as ControlKnowledge;
}

function mapEffectiveStatus(status: string): PackEffectiveStatus {
  if (status === "유지") {
    return "active";
  }
  if (status === "삭제") {
    return "deleted_residual_risk";
  }
  throw new Error(`Unsupported OpenKB control status: ${status}`);
}

function mapSourceConfidence(confidence: string | undefined): PackSourceConfidence {
  if (confidence === "official_verified" || confidence === "human_curated") {
    return confidence;
  }
  return "ocr_derived";
}

function buildRequirement(annex: AnnexMappingRow, evidence: EvidenceRequirementRow[]): string {
  const firstCriterion = evidence[0]?.acceptance_criteria;
  return firstCriterion ? `${annex.control_name}: ${firstCriterion}` : `${annex.control_name} 요구사항은 OpenKB 검토가 필요하다.`;
}

function buildIntent(annex: AnnexMappingRow, status: PackEffectiveStatus): string {
  if (status === "deleted_residual_risk") {
    return `Preserve traceability for deleted control ${annex.control_id} ${annex.control_name} and require residual-risk review before treating it as not applicable.`;
  }
  return `Confirm operating coverage for ${annex.control_id} ${annex.control_name} using OpenKB-derived evidence requirements.`;
}

function buildApplicabilityQuestions(annex: AnnexMappingRow, status: PackEffectiveStatus): string[] {
  if (status === "deleted_residual_risk") {
    return [
      `Does ${annex.control_name} remain relevant through contracts, privacy obligations, or customer security requirements?`,
      "Has a human owner confirmed the deleted-control residual risk?"
    ];
  }
  return [
    `Does the service operate systems or data flows covered by ${annex.control_name}?`,
    `Is there an owner for reviewing ${annex.control_name} evidence?`
  ];
}

function buildObservableSignals(annex: AnnexMappingRow, evidence: EvidenceRequirementRow[]): string[] {
  return unique([
    annex.control_name,
    ...evidence.map((row) => row.title),
    ...evidence.map((row) => row.evidence_type)
  ]);
}

function buildOperatingPractices(annex: AnnexMappingRow, status: PackEffectiveStatus): string[] {
  if (status === "deleted_residual_risk") {
    return [
      "deleted-control decision review",
      "residual risk assessment",
      "human confirmation before treating the control as not applicable"
    ];
  }
  return [
    `${annex.control_name} policy ownership and review cycle`,
    `${annex.control_name} evidence review`,
    `${annex.control_name} exception approval`
  ];
}

function buildCommonDefects(annex: AnnexMappingRow, status: PackEffectiveStatus): string[] {
  if (status === "deleted_residual_risk") {
    return [
      "treating the deleted control as if no residual risk exists",
      "creating a normal remediation gap from a deleted control",
      "missing human confirmation for deleted-control applicability"
    ];
  }
  return [
    `${annex.control_name} evidence exists but has no owner`,
    `${annex.control_name} settings are captured once but not reviewed`,
    `${annex.control_name} exceptions are handled informally`
  ];
}

async function findWikiControlFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  await walk(root, files);
  return files.filter((path) => path.endsWith(".md"));
}

async function walk(root: string, files: string[]): Promise<void> {
  try {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const path = join(root, entry.name);
      if (entry.isDirectory()) {
        await walk(path, files);
      } else if (entry.isFile()) {
        files.push(path);
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

function normalizeOpenKbPath(openkbRoot: string, path: string): string {
  return relative(openkbRoot, path).split("\\").join("/");
}

function unique(values: string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean).filter((value, index, list) => list.indexOf(value) === index);
}
```

- [ ] **Step 5: Run the focused test**

Run:

```bash
npm run build
node --test dist/test/generator/openkb-pack.test.js
```

Expected: all generator tests pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/generator/openkb-types.ts src/generator/openkb-pack.ts test/generator/openkb-pack.test.ts
git commit -m "feat: generate draft packs from OpenKB"
```

## Task 3: Add Source Manifest Conflict Assertions

**Files:**
- Modify: `test/generator/openkb-pack.test.ts`
- Modify: `src/generator/openkb-pack.ts`

- [ ] **Step 1: Add failing source manifest assertions**

Append to the generator test file:

```ts
test("generatePackFromOpenKb records raw legal conflicts without direct raw source refs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-pack-generate-"));
  try {
    const openkbRoot = join(process.cwd(), "test", "fixtures", "openkb");
    const packRoot = join(dir, "isms-p-generated-v0");

    await generatePackFromOpenKb({
      openkbRoot,
      packRoot,
      packName: "isms-p-generated-v0",
      version: "0.1.0",
      controlIds: ["ISMS-P-2.5.3"]
    });

    const manifest = JSON.parse(await readFile(join(packRoot, "sources", "source-manifest.json"), "utf8"));

    assert.equal(manifest.openkbSources.includes("raw/legal/7의2_ISMS-P_인증기준_항목_목록.jsonl"), false);
    assert.deepEqual(manifest.sourceProfileReferences, [
      {
        path: "raw/legal/7의2_ISMS-P_인증기준_항목_목록.jsonl",
        purpose: "source-profile cross-check; do not treat as direct control source for generated pack IDs"
      }
    ]);
    assert.deepEqual(manifest.knownSourceProfileConflicts, [
      {
        packControlId: "ISMS-P-2.5.3",
        packControlName: "사용자 인증",
        rawLegalControlId: "ISMS-P-2.4.3",
        rawLegalControlName: "사용자 인증"
      }
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the focused test to verify it fails if conflict handling is absent**

Run:

```bash
npm run build
node --test dist/test/generator/openkb-pack.test.js
```

Expected: the new test fails because `sourceProfileReferences` is `[]` and `knownSourceProfileConflicts` is `[]`.

- [ ] **Step 3: Ensure implementation matches the assertions**

Update `src/generator/openkb-pack.ts` imports so `RawLegalRow` is included:

```ts
import type {
  AnnexMappingRow,
  EvidenceRequirementRow,
  GeneratePackOptions,
  GeneratePackResult,
  RawLegalRow,
  SourceClaimRow
} from "./openkb-types.js";
```

Read the optional raw legal profile after evidence rows:

```ts
  const rawLegalRows = await readOptionalJsonl<RawLegalRow>(join(options.openkbRoot, RAW_LEGAL_PROFILE_PATH));
```

Update the `source-manifest.json` object:

```ts
sourceProfileReferences: rawLegalRows.length > 0 ? [
  {
    path: RAW_LEGAL_PROFILE_PATH,
    purpose: "source-profile cross-check; do not treat as direct control source for generated pack IDs"
  }
] : [],
knownSourceProfileConflicts: detectRawLegalConflicts(selectedControls, rawLegalRows),
```

Add these helper functions before `findWikiControlFiles()`:

```ts
function detectRawLegalConflicts(controls: ControlKnowledge[], rows: RawLegalRow[]): Array<{
  packControlId: string;
  packControlName: string;
  rawLegalControlId: string;
  rawLegalControlName: string;
}> {
  return controls.flatMap((control) => {
    const sameNameDifferentId = rows.find((row) => row.control_name === control.title && row.control_id !== control.control_id);
    return sameNameDifferentId ? [{
      packControlId: control.control_id,
      packControlName: control.title,
      rawLegalControlId: sameNameDifferentId.control_id,
      rawLegalControlName: sameNameDifferentId.control_name
    }] : [];
  });
}

async function readOptionalJsonl<T>(path: string): Promise<T[]> {
  try {
    return await readJsonl<T>(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
```

Keep `openkbSources` limited to compiled/wiki paths and do not add `RAW_LEGAL_PROFILE_PATH` to that array.

- [ ] **Step 4: Run the focused test**

Run:

```bash
npm run build
node --test dist/test/generator/openkb-pack.test.js
```

Expected: all generator tests pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/generator/openkb-pack.ts test/generator/openkb-pack.test.ts
git commit -m "test: cover OpenKB source profile conflicts"
```

## Task 4: Add Command-Level Generate Function and CLI Route

**Files:**
- Modify: `src/commands/pack.ts`
- Modify: `src/cli.ts`
- Create: `test/commands/pack-generate.test.ts`

- [ ] **Step 1: Write failing command-level CLI test**

Create `test/commands/pack-generate.test.ts`:

```ts
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("CLI generates a pack from fixture OpenKB inputs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-cli-pack-generate-"));
  try {
    const openkbRoot = join(process.cwd(), "test", "fixtures", "openkb");
    const packRoot = join(dir, "generated-pack");
    const result = spawnSync(process.execPath, [
      join(process.cwd(), "dist", "cli.js"),
      "pack",
      "generate",
      "--openkb",
      openkbRoot,
      "--pack",
      packRoot,
      "--controls",
      "ISMS-P-2.5.3,ISMS-P-2.5.6"
    ], {
      cwd: process.cwd(),
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /generatedControls/);
    assert.match(result.stdout, /ISMS-P-2\.5\.3/);

    const pack = JSON.parse(await readFile(join(packRoot, "pack.json"), "utf8"));
    assert.equal(pack.name, "generated-pack");
    assert.deepEqual(pack.controls, ["ISMS-P-2.5.3", "ISMS-P-2.5.6"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI rejects incomplete pack generate arguments", () => {
  const result = spawnSync(process.execPath, [
    join(process.cwd(), "dist", "cli.js"),
    "pack",
    "generate",
    "--openkb",
    "test/fixtures/openkb"
  ], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage: isms-agent pack generate/);
});
```

- [ ] **Step 2: Run command tests to verify failure**

Run:

```bash
npm run build
node --test dist/test/commands/pack-generate.test.js
```

Expected: CLI rejects `pack generate` because the route does not exist.

- [ ] **Step 3: Add command wrapper and argument parser**

Modify `src/commands/pack.ts` by adding these exports near the top-level exports:

```ts
import { basename, resolve } from "node:path";
import { generatePackFromOpenKb } from "../generator/openkb-pack.js";
import type { GeneratePackResult } from "../generator/openkb-types.js";

export interface PackGenerateCliOptions {
  openkbRoot: string;
  packRoot: string;
  controlIds: string[];
  version: string;
}

export function parsePackGenerateArgs(args: string[]): PackGenerateCliOptions | undefined {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--openkb" || arg === "--pack" || arg === "--controls" || arg === "--version") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        return undefined;
      }
      values.set(arg, value);
      index += 1;
      continue;
    }
    return undefined;
  }

  const openkbRoot = values.get("--openkb");
  const packRoot = values.get("--pack");
  const controls = values.get("--controls");
  if (!openkbRoot || !packRoot || !controls) {
    return undefined;
  }

  const controlIds = controls.split(",").map((controlId) => controlId.trim()).filter(Boolean);
  if (controlIds.length === 0) {
    return undefined;
  }

  return {
    openkbRoot,
    packRoot,
    controlIds,
    version: values.get("--version") ?? "0.1.0"
  };
}

export async function generatePack(options: PackGenerateCliOptions): Promise<GeneratePackResult> {
  const packRoot = resolve(process.cwd(), options.packRoot);
  return generatePackFromOpenKb({
    openkbRoot: resolve(process.cwd(), options.openkbRoot),
    packRoot,
    packName: basename(packRoot),
    version: options.version,
    controlIds: options.controlIds
  });
}
```

If the file already imports `join, relative` from `node:path`, combine imports into:

```ts
import { basename, join, relative, resolve } from "node:path";
```

- [ ] **Step 4: Add CLI route**

Modify `src/cli.ts`:

```ts
import { generatePack, parsePackGenerateArgs, validatePack } from "./commands/pack.js";
```

Add this route before `pack validate`:

```ts
  if (command === "pack" && args[0] === "generate") {
    const parsed = parsePackGenerateArgs(args.slice(1));
    if (parsed) {
      const result = await generatePack(parsed);
      console.log(JSON.stringify(result, null, 2));
      return;
    }
  }
```

Update usage:

```ts
  console.error("Usage: isms-agent pack generate --openkb <openkb-dir> --pack <pack-dir> --controls <ids> [--version <version>]");
```

- [ ] **Step 5: Run command tests**

Run:

```bash
npm run build
node --test dist/test/commands/pack-generate.test.js
```

Expected: both command tests pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/commands/pack.ts src/cli.ts test/commands/pack-generate.test.ts
git commit -m "feat: add pack generate command"
```

## Task 5: Add README Usage and Final Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add README generator section**

In `README.md`, under `Control Knowledge Pack v0`, add:

````markdown
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
````

- [ ] **Step 2: Run full verification**

Run:

```bash
npm test
npm run check
node dist/cli.js pack generate --openkb test/fixtures/openkb --pack /private/tmp/isms-agent-generated-pack --controls ISMS-P-2.5.3,ISMS-P-2.5.6
node dist/cli.js pack validate /private/tmp/isms-agent-generated-pack
git diff --check
git diff --cached --check
```

Expected:

- `npm test`: all tests pass.
- `npm run check`: exits 0.
- `pack generate`: prints JSON with `generatedControls`.
- `pack validate`: prints `valid: true`, `checkedControls: 2`, `issues: []`.
- diff checks produce no output and exit 0.

- [ ] **Step 3: Inspect generated source refs**

Run:

```bash
rg -n "raw/legal|compiled/controls|compiled/citations|compiled/evidence|wiki/controls" /private/tmp/isms-agent-generated-pack
```

Expected:

- `raw/legal/7의2_ISMS-P_인증기준_항목_목록.jsonl` appears only in `sources/source-manifest.json`.
- `compiled/controls/annex_7_2_mapping.jsonl` appears in `source-manifest.json` and generated control `source_refs`.
- `compiled/citations/source_claims.jsonl` appears in generated control `source_refs`.
- `compiled/evidence/evidence_requirements.jsonl` appears in generated control `source_refs`.
- `wiki/controls/...` appears in generated control `source_refs` when fixture wiki files exist.

- [ ] **Step 4: Commit**

Run:

```bash
git add README.md
git commit -m "docs: document pack generate workflow"
```

## Self-Review Checklist

- Spec coverage: Tasks implement local OpenKB input parsing, deterministic pack generation, raw/legal cross-check handling, human-review metadata, validator integration, CLI usage, tests, and README usage.
- Placeholder scan: This plan contains concrete file paths, commands, fixture content, tests, implementation snippets, and expected outputs.
- Type consistency: `GeneratePackOptions`, `GeneratePackResult`, `generatePackFromOpenKb()`, `parsePackGenerateArgs()`, and `generatePack()` are defined before later tasks use them.
