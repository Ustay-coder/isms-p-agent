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

test("pack source references use compiled OpenKB claims as direct sources", async () => {
  const controls = await loadPackControls();
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
  }

  const sourceManifest = JSON.parse(await readFile(join(PACK_ROOT, "sources", "source-manifest.json"), "utf8")) as {
    openkbSources: string[];
    sourceProfileReferences?: Array<{ path: string; purpose: string }>;
    knownSourceProfileConflicts?: Array<{ packControlId: string; rawLegalControlId: string }>;
  };

  assert.equal(sourceManifest.openkbSources.includes("raw/legal/7의2_ISMS-P_인증기준_항목_목록.jsonl"), false);
  assert.deepEqual(sourceManifest.sourceProfileReferences, [
    {
      path: "raw/legal/7의2_ISMS-P_인증기준_항목_목록.jsonl",
      purpose: "source-profile cross-check; do not treat as direct control source for v0 pack IDs"
    }
  ]);
  assert.deepEqual(
    sourceManifest.knownSourceProfileConflicts?.map((conflict) => ({
      packControlId: conflict.packControlId,
      rawLegalControlId: conflict.rawLegalControlId
    })),
    [
      {
        packControlId: "ISMS-P-2.5.3",
        rawLegalControlId: "ISMS-P-2.4.3"
      },
      {
        packControlId: "ISMS-P-2.10.2",
        rawLegalControlId: "ISMS-P-2.9.2"
      }
    ]
  );
});

test("public pack files avoid private absolute paths and credential-looking values", async () => {
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
    assert.doesNotMatch(content, /overlays\/evaluate-club/);
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
