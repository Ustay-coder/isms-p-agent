import assert from "node:assert/strict";
import { mkdir, readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validatePack } from "../../src/commands/pack.js";
import { readJsonl } from "../../src/core/jsonl.js";
import { generatePackFromOpenKb } from "../../src/generator/openkb-pack.js";

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

test("OpenKB fixture records active, deleted, and raw legal conflict rows", async () => {
  const openkbRoot = join(process.cwd(), "test", "fixtures", "openkb");

  const controls = await readJsonl<{ control_id: string; control_name: string; status: string }>(
    join(openkbRoot, "compiled", "controls", "annex_7_2_mapping.jsonl")
  );
  const claims = await readJsonl<{ claim_id: string; control_id: string; effective_status: string }>(
    join(openkbRoot, "compiled", "citations", "source_claims.jsonl")
  );
  const evidence = await readJsonl<{ evidence_id: string; control_id: string; title: string }>(
    join(openkbRoot, "compiled", "evidence", "evidence_requirements.jsonl")
  );
  const rawLegal = await readJsonl<{ control_id: string; control_name: string }>(
    join(openkbRoot, "raw", "legal", "7의2_ISMS-P_인증기준_항목_목록.jsonl")
  );

  assert.deepEqual(
    controls.map((row) => [row.control_id, row.control_name, row.status]),
    [
      ["ISMS-P-2.5.3", "사용자 인증", "유지"],
      ["ISMS-P-2.5.6", "접근권한 검토", "삭제"]
    ]
  );
  assert.deepEqual(claims.map((row) => [row.claim_id, row.control_id, row.effective_status]), [
    ["CLM-2.5.3", "ISMS-P-2.5.3", "유지"],
    ["CLM-2.5.6", "ISMS-P-2.5.6", "삭제"]
  ]);
  assert.deepEqual(evidence.map((row) => row.evidence_id), [
    "EV-ISMS-P-2.5.3-001",
    "EV-ISMS-P-2.5.3-002",
    "EV-ISMS-P-2.5.6-001"
  ]);

  assert.deepEqual(
    rawLegal.map((row) => [row.control_id, row.control_name]),
    [
      ["ISMS-P-2.4.3", "사용자 인증"],
      ["ISMS-P-2.5.3", "원격접근 통제"]
    ]
  );
});

test("OpenKB fixture wiki pages exist for generated controls", async () => {
  const wikiRoot = join(process.cwd(), "test", "fixtures", "openkb", "wiki", "controls", "2_보호대책_요구사항");

  const activeWiki = await readFile(join(wikiRoot, "ISMS-P-2.5.3_사용자_인증.md"), "utf8");
  const deletedWiki = await readFile(join(wikiRoot, "ISMS-P-2.5.6_접근권한_검토.md"), "utf8");

  assert.match(activeWiki, /control_id: ISMS-P-2\.5\.3/);
  assert.match(activeWiki, /source_claim_id: CLM-2\.5\.3/);
  assert.match(deletedWiki, /control_id: ISMS-P-2\.5\.6/);
  assert.match(deletedWiki, /삭제 상태/);
});

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

test("generatePackFromOpenKb validates annex status even when source claim effective_status exists", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-pack-generate-effective-status-"));
  try {
    const openkbRoot = join(dir, "openkb");
    const packRoot = join(dir, "pack");
    await writeMinimalOpenKb(openkbRoot, {
      controlId: "ISMS-P-2.2.4",
      controlName: "인식제고 및 교육훈련",
      annexStatus: "미확인",
      effectiveStatus: "유지",
      wikiFileName: "ISMS-P-2.2.4_인식제고_및_교육훈련.md"
    });

    await assert.rejects(
      generatePackFromOpenKb({
        openkbRoot,
        packRoot,
        packName: "generated-pack",
        version: "0.2.0",
        controlIds: ["ISMS-P-2.2.4"]
      }),
      /Unsupported OpenKB control status: 미확인/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

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

test("generatePackFromOpenKb rejects path-unsafe OpenKB control IDs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-pack-generate-"));
  try {
    const openkbRoot = join(dir, "openkb");
    const packRoot = join(dir, "pack");
    await writeMinimalOpenKb(openkbRoot, {
      controlId: "../bad",
      controlName: "잘못된 통제",
      wikiFileName: ".._bad_잘못된_통제.md"
    });

    await assert.rejects(
      generatePackFromOpenKb({
        openkbRoot,
        packRoot,
        packName: "bad-pack",
        version: "0.1.0",
        controlIds: ["../bad"]
      }),
      /Unsupported OpenKB control_id/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generatePackFromOpenKb selects the exact wiki file deterministically", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-pack-generate-"));
  try {
    const openkbRoot = join(dir, "openkb");
    const packRoot = join(dir, "pack");
    await writeMinimalOpenKb(openkbRoot, {
      controlId: "ISMS-P-2.5.3",
      controlName: "사용자 인증",
      wikiFileName: "ISMS-P-2.5.3_사용자_인증.md"
    });
    await mkdir(join(openkbRoot, "wiki", "controls", "0_old"), { recursive: true });
    await writeFile(
      join(openkbRoot, "wiki", "controls", "0_old", "ISMS-P-2.5.3_이전_사용자_인증.md"),
      "# stale wiki page\n"
    );

    await generatePackFromOpenKb({
      openkbRoot,
      packRoot,
      packName: "generated-pack",
      version: "0.1.0",
      controlIds: ["ISMS-P-2.5.3"]
    });

    const active = JSON.parse(await readFile(join(packRoot, "controls", "ISMS-P-2.5.3.json"), "utf8"));
    const wikiRefs = active.source_refs
      .map((sourceRef: { sourcePath: string }) => sourceRef.sourcePath)
      .filter((sourcePath: string) => sourcePath.startsWith("wiki/"));

    assert.deepEqual(wikiRefs, [
      "wiki/controls/2_보호대책_요구사항/ISMS-P-2.5.3_사용자_인증.md"
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generatePackFromOpenKb rejects controls without matching source claims", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-pack-generate-"));
  try {
    const openkbRoot = join(dir, "openkb");
    const packRoot = join(dir, "pack");
    await writeMinimalOpenKb(openkbRoot, {
      controlId: "ISMS-P-2.5.3",
      controlName: "사용자 인증",
      wikiFileName: "ISMS-P-2.5.3_사용자_인증.md"
    });
    await writeFile(join(openkbRoot, "compiled", "citations", "source_claims.jsonl"), "");

    await assert.rejects(
      generatePackFromOpenKb({
        openkbRoot,
        packRoot,
        packName: "generated-pack",
        version: "0.1.0",
        controlIds: ["ISMS-P-2.5.3"]
      }),
      /OpenKB source claims are missing ISMS-P-2\.5\.3/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generatePackFromOpenKb removes stale control files when regenerating", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-pack-generate-"));
  try {
    const openkbRoot = join(process.cwd(), "test", "fixtures", "openkb");
    const packRoot = join(dir, "isms-p-generated-v0");

    await generatePackFromOpenKb({
      openkbRoot,
      packRoot,
      packName: "isms-p-generated-v0",
      version: "0.1.0",
      controlIds: ["ISMS-P-2.5.3", "ISMS-P-2.5.6"]
    });
    await generatePackFromOpenKb({
      openkbRoot,
      packRoot,
      packName: "isms-p-generated-v0",
      version: "0.1.0",
      controlIds: ["ISMS-P-2.5.3"]
    });

    const validation = await validatePack(packRoot);

    assert.equal(validation.valid, true);
    assert.equal(validation.checkedControls, 1);
    assert.deepEqual(validation.issues, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generatePackFromOpenKb rejects merged controls until merge metadata is supported", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-pack-generate-"));
  try {
    const openkbRoot = join(dir, "openkb");
    const packRoot = join(dir, "pack");
    await writeMinimalOpenKb(openkbRoot, {
      controlId: "ISMS-P-2.5.3",
      controlName: "사용자 인증",
      mergedInto: "ISMS-P-2.5.4",
      wikiFileName: "ISMS-P-2.5.3_사용자_인증.md"
    });

    await assert.rejects(
      generatePackFromOpenKb({
        openkbRoot,
        packRoot,
        packName: "generated-pack",
        version: "0.1.0",
        controlIds: ["ISMS-P-2.5.3"]
      }),
      /OpenKB merged control ISMS-P-2\.5\.3 must be reviewed before generation/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function writeMinimalOpenKb(
  openkbRoot: string,
  options: {
    controlId: string;
    controlName: string;
    annexStatus?: "유지" | "삭제" | string;
    effectiveStatus?: "유지" | "삭제" | string;
    mergedInto?: string;
    wikiFileName: string;
  }
): Promise<void> {
  await mkdir(join(openkbRoot, "compiled", "controls"), { recursive: true });
  await mkdir(join(openkbRoot, "compiled", "citations"), { recursive: true });
  await mkdir(join(openkbRoot, "compiled", "evidence"), { recursive: true });
  await mkdir(join(openkbRoot, "wiki", "controls", "2_보호대책_요구사항"), { recursive: true });

  await writeFile(
    join(openkbRoot, "compiled", "controls", "annex_7_2_mapping.jsonl"),
    JSON.stringify({
      control_id: options.controlId,
      control_name: options.controlName,
      part: "보호대책 요구사항",
      domain_id: "2.5",
      status: options.annexStatus ?? "유지",
      simplified_control_id: options.controlId,
      merged_into: options.mergedInto ?? null,
      source_pages: [1]
    }) + "\n"
  );
  await writeFile(
    join(openkbRoot, "compiled", "citations", "source_claims.jsonl"),
    JSON.stringify({
      claim_id: "CLM-test",
      control_id: options.controlId,
      control_name: options.controlName,
      effective_status: options.effectiveStatus ?? options.annexStatus ?? "유지",
      confidence: "ocr_derived",
      review_status: "needs_human_review",
      source_path: "raw/official/test.jsonl",
      pages: [1]
    }) + "\n"
  );
  await writeFile(
    join(openkbRoot, "compiled", "evidence", "evidence_requirements.jsonl"),
    JSON.stringify({
      evidence_id: "EV-test",
      control_id: options.controlId,
      control_name: options.controlName,
      domain_name: "인증 및 권한관리",
      title: "테스트 증적",
      evidence_type: "policy",
      automation_candidate: false,
      acceptance_criteria: "테스트 기준"
    }) + "\n"
  );
  await writeFile(
    join(openkbRoot, "wiki", "controls", "2_보호대책_요구사항", options.wikiFileName),
    `# ${options.controlId} ${options.controlName}\n`
  );
}
