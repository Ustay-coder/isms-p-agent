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
