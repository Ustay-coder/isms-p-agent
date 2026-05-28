import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
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
