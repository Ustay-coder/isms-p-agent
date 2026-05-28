import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { stringifyJson } from "../../src/core/json.js";
import { validatePack } from "../../src/commands/pack.js";
import type { ControlKnowledge } from "../../src/schemas/control.js";

test("validatePack accepts the checked-in core v0 pack", async () => {
  const result = await validatePack(join(process.cwd(), "packs", "isms-p-core-v0"));

  assert.equal(result.valid, true);
  assert.deepEqual(result.issues, []);
  assert.equal(result.checkedControls, 3);
});

test("validatePack rejects raw legal direct refs and private overlay paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-pack-"));
  try {
    const packRoot = join(dir, "bad-pack");
    await writeMinimalPack(packRoot, [
      control({
        source_refs: [
          {
            sourcePath: "raw/legal/7의2_ISMS-P_인증기준_항목_목록.jsonl",
            sha256: "openkb-managed",
            excerpt: "ISMS-P-2.5.3 사용자 인증"
          }
        ]
      }),
      control({
        control_id: "ISMS-P-2.10.2",
        title: "클라우드 보안",
        source_refs: [
          {
            sourcePath: "overlays/evaluate-club/evidence/controls/ISMS-P-2.10.2_클라우드_보안.md",
            sha256: "openkb-managed"
          }
        ]
      })
    ]);

    const result = await validatePack(packRoot);

    assert.equal(result.valid, false);
    assert.match(result.issues.join("\n"), /raw legal profile rows as direct source_refs/);
    assert.match(result.issues.join("\n"), /private overlay path/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI validates the default checked-in pack", () => {
  const result = spawnSync(process.execPath, [join(process.cwd(), "dist", "cli.js"), "pack", "validate"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /valid/);
  assert.match(result.stdout, /checkedControls.*3/);
});

async function writeMinimalPack(packRoot: string, controls: ControlKnowledge[]): Promise<void> {
  await mkdir(join(packRoot, "controls"), { recursive: true });
  await mkdir(join(packRoot, "sources"), { recursive: true });
  await writeFile(join(packRoot, "pack.json"), stringifyJson({
    schemaVersion: 1,
    name: "bad-pack",
    sourceOfTruth: "openkb",
    controlCount: controls.length,
    controls: controls.map((item) => item.control_id)
  }));
  await writeFile(join(packRoot, "sources", "source-manifest.json"), stringifyJson({
    schemaVersion: 1,
    sourceOfTruth: "openkb",
    openkbSources: ["compiled/controls/annex_7_2_mapping.jsonl"],
    privateOverlaysIncluded: false
  }));

  for (const item of controls) {
    await writeFile(join(packRoot, "controls", `${item.control_id}.json`), stringifyJson(item));
  }
}

function control(overrides: Partial<ControlKnowledge> = {}): ControlKnowledge {
  return {
    schemaVersion: 1,
    control_id: "ISMS-P-2.5.3",
    title: "사용자 인증",
    domain: "보호대책 요구사항",
    category: "인증 및 권한관리",
    requirement: "Operate authentication controls.",
    intent: "Confirm authentication control operation.",
    applicability_questions: ["Is authentication used?"],
    observable_signals: ["mfa"],
    required_operating_practices: ["authentication policy review"],
    required_evidence: ["authentication policy"],
    common_defects: ["No review cycle"],
    automation_potential: "partial",
    human_review_required: true,
    source_refs: [
      {
        sourcePath: "compiled/controls/annex_7_2_mapping.jsonl",
        sha256: "openkb-managed"
      }
    ],
    pack: {
      name: "bad-pack",
      source_of_truth: "openkb",
      openkb_control_id: "ISMS-P-2.5.3",
      effective_status: "active",
      review_status: "needs_human_review",
      source_confidence: "ocr_derived"
    },
    ...overrides
  } as ControlKnowledge;
}
