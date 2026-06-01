import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import type { ControlKnowledge } from "../../src/schemas/control.js";

const PACK_ROOT = join(process.cwd(), "packs", "isms-p-core-v0");

test("isms-p-core-v0 pack has the expected OpenKB controls", async () => {
  const names = (await readdir(join(PACK_ROOT, "controls"))).filter((name) => name.endsWith(".json")).sort();

  assert.equal(names.length, 88);
  assert.ok(names.includes("ISMS-P-1.1.1.json"));
  assert.ok(names.includes("ISMS-P-2.5.3.json"));
  assert.ok(names.includes("ISMS-P-2.10.2.json"));
  assert.ok(names.includes("ISMS-P-3.5.3.json"));
  assert.equal(names.includes("ISMS-P-1.1.3.json"), false);
  assert.equal(names.includes("ISMS-P-2.4.2.json"), false);
  assert.equal(names.includes("ISMS-P-2.11.1.json"), false);

  const controls = await Promise.all(names.map(async (name) => {
    return JSON.parse(await readFile(join(PACK_ROOT, "controls", name), "utf8")) as ControlKnowledge;
  }));

  assert.deepEqual(controls.map((control) => `${control.control_id}.json`).sort(), names);
  assert.equal(controls.every((control) => control.pack?.source_of_truth === "openkb"), true);
  assert.equal(controls.filter((control) => control.pack?.effective_status === "active").length, 57);
  assert.equal(controls.filter((control) => control.pack?.effective_status === "deleted_residual_risk").length, 31);
});

test("active pack controls have analyzer-useful fields", async () => {
  const controls = await loadPackControls();
  const active = controls.filter((control) => control.pack?.effective_status === "active");

  assert.equal(active.length, 57);
  for (const control of active) {
    assert.ok(control.observable_signals.length >= 5, `${control.control_id} observable_signals`);
    assert.ok(control.required_operating_practices.length >= 3, `${control.control_id} operating practices`);
    assert.ok(control.required_evidence.length >= 2, `${control.control_id} required evidence`);
    assert.ok(control.common_defects.length >= 3, `${control.control_id} common defects`);
  }
});

test("active pack controls have requirement-level evidence mappings", async () => {
  const controls = await loadPackControls();
  const sourceManifest = JSON.parse(await readFile(join(PACK_ROOT, "sources", "source-manifest.json"), "utf8")) as {
    openkbSources: string[];
  };
  const manifestSources = new Set(sourceManifest.openkbSources);

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
      for (const sourceRef of requirement.source_refs.filter((ref) => ref.sourcePath.startsWith("wiki/"))) {
        assert.equal(
          manifestSources.has(sourceRef.sourcePath),
          true,
          `${requirement.requirement_id} wiki source_ref must be declared in source-manifest.json`
        );
      }
    }
  }
});

test("deleted access review control is modeled as residual risk", async () => {
  const controls = await loadPackControls();
  const accessReview = controls.find((control) => control.control_id === "ISMS-P-2.5.6");

  assert.equal(accessReview?.pack?.effective_status, "deleted_residual_risk");
  assert.match(accessReview?.intent ?? "", /deleted/i);
  assert.ok(accessReview?.required_evidence.some((evidence) => /잔존 리스크|법적/.test(evidence)));
  assert.ok(accessReview?.required_operating_practices.includes("residual risk assessment"));
});

test("pack source references use compiled OpenKB claims as direct sources", async () => {
  const controls = await loadPackControls();
  const sourceManifest = JSON.parse(await readFile(join(PACK_ROOT, "sources", "source-manifest.json"), "utf8")) as {
    openkbSources: string[];
    sourceProfileReferences?: Array<{ path: string; purpose: string }>;
    knownSourceProfileConflicts?: Array<{ packControlId: string; rawLegalControlId: string }>;
  };
  const manifestSources = new Set(sourceManifest.openkbSources);

  for (const control of controls) {
    assert.equal(
      control.source_refs.some((sourceRef) => sourceRef.sourcePath === "raw/legal/7의2_ISMS-P_인증기준_항목_목록.jsonl"),
      false,
      `${control.control_id} must not cite raw legal profile rows as direct source_refs`
    );
    assert.equal(
      control.source_refs.some((sourceRef) => sourceRef.sourcePath.startsWith("compiled/")),
      true,
      `${control.control_id} must cite compiled OpenKB sources`
    );
    for (const sourceRef of control.source_refs.filter((ref) => ref.sourcePath.startsWith("wiki/"))) {
      assert.equal(
        manifestSources.has(sourceRef.sourcePath),
        true,
        `${control.control_id} wiki source_ref must be declared in source-manifest.json`
      );
    }
  }

  assert.equal(sourceManifest.openkbSources.includes("raw/legal/7의2_ISMS-P_인증기준_항목_목록.jsonl"), false);
  assert.deepEqual(sourceManifest.sourceProfileReferences, [
    {
      path: "raw/legal/7의2_ISMS-P_인증기준_항목_목록.jsonl",
      purpose: "source-profile cross-check; do not treat as direct control source for generated pack IDs"
    }
  ]);
  assert.equal(sourceManifest.knownSourceProfileConflicts?.length, 27);
  assert.ok(sourceManifest.knownSourceProfileConflicts?.some((conflict) =>
    conflict.packControlId === "ISMS-P-2.5.3" && conflict.rawLegalControlId === "ISMS-P-2.4.3"
  ));
  assert.ok(sourceManifest.knownSourceProfileConflicts?.some((conflict) =>
    conflict.packControlId === "ISMS-P-2.10.2" && conflict.rawLegalControlId === "ISMS-P-2.9.2"
  ));
});

test("public pack files avoid private absolute paths and credential-looking values", async () => {
  const files = [
    "pack.json",
    "sources/source-manifest.json",
    ...(await readdir(join(PACK_ROOT, "controls")))
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => `controls/${name}`)
  ];

  for (const file of files) {
    const content = await readFile(join(PACK_ROOT, file), "utf8");
    assert.doesNotMatch(content, /\/Users\//);
    assert.doesNotMatch(content, /apps\/evaluation/);
    assert.doesNotMatch(content, /overlays\/evaluate-club/);
    assert.doesNotMatch(content, /evaluate\.club/);
    assert.doesNotMatch(content, /evaluate\.club asset map/);
    assert.doesNotMatch(content, /["']?\b(?:api[_-]?key|token|secret)\b["']?\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{12,}/i);
    assert.doesNotMatch(content, /"value"\s*:\s*"[^"]*(?:api[_-]?key|token|secret)[^"]*"/i);
  }
});

async function loadPackControls(): Promise<ControlKnowledge[]> {
  const names = (await readdir(join(PACK_ROOT, "controls"))).filter((name) => name.endsWith(".json"));
  return Promise.all(names.map(async (name) => {
    return JSON.parse(await readFile(join(PACK_ROOT, "controls", name), "utf8")) as ControlKnowledge;
  }));
}
