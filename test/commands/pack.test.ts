import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { stringifyJson } from "../../src/core/json.js";
import { installPack, validatePack } from "../../src/commands/pack.js";
import type { ControlKnowledge } from "../../src/schemas/control.js";

test("validatePack accepts the checked-in core v0 pack", async () => {
  const result = await validatePack(join(process.cwd(), "packs", "isms-p-core-v0"));

  assert.equal(result.valid, true);
  assert.deepEqual(result.issues, []);
  assert.equal(result.checkedControls, 3);
});

test("installPack copies validated pack controls into a workspace without overwriting by default", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-pack-install-"));
  try {
    const packRoot = join(process.cwd(), "packs", "isms-p-core-v0");
    const result = await installPack(dir, {
      packRoot,
      overwrite: false
    });

    assert.equal(result.installedControls, 3);
    assert.deepEqual(result.skippedControls, []);
    assert.equal(result.outputDir, join(dir, "controls"));

    const installed = JSON.parse(await readFile(join(dir, "controls", "ISMS-P-2.10.2.json"), "utf8"));
    assert.equal(installed.control_id, "ISMS-P-2.10.2");

    await writeFile(join(dir, "controls", "ISMS-P-2.10.2.json"), "{\"local\":true}\n");
    const second = await installPack(dir, { packRoot, overwrite: false });
    assert.equal(second.installedControls, 2);
    assert.deepEqual(second.skippedControls, ["ISMS-P-2.10.2.json"]);

    const preserved = await readFile(join(dir, "controls", "ISMS-P-2.10.2.json"), "utf8");
    assert.equal(preserved, "{\"local\":true}\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("installPack resolves relative pack roots from the workspace root", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-pack-install-relative-"));
  try {
    const packRoot = join(dir, "packs", "isms-p-core-v0");
    await writeMinimalPack(packRoot, [control()]);

    const result = await installPack(dir, {
      packRoot: "packs/isms-p-core-v0",
      overwrite: false
    });

    assert.equal(result.packRoot, packRoot);
    assert.equal(result.installedControls, 1);
    assert.deepEqual(result.skippedControls, []);
    assert.equal(result.outputDir, join(dir, "controls"));

    const installed = JSON.parse(await readFile(join(dir, "controls", "ISMS-P-2.5.3.json"), "utf8"));
    assert.equal(installed.control_id, "ISMS-P-2.5.3");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("installPack overwrites differing local controls when requested", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-pack-install-overwrite-"));
  try {
    const packRoot = join(process.cwd(), "packs", "isms-p-core-v0");
    await installPack(dir, { packRoot, overwrite: false });

    const localPath = join(dir, "controls", "ISMS-P-2.10.2.json");
    await writeFile(localPath, "{\"local\":true}\n");
    const result = await installPack(dir, { packRoot, overwrite: true });

    assert.equal(result.installedControls, 3);
    assert.deepEqual(result.skippedControls, []);

    const replaced = JSON.parse(await readFile(localPath, "utf8"));
    assert.equal(replaced.control_id, "ISMS-P-2.10.2");
    assert.equal(replaced.local, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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

test("validatePack rejects any raw legal path from direct OpenKB sources", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-pack-"));
  try {
    const packRoot = join(dir, "bad-pack");
    await writeMinimalPack(packRoot, [control()]);
    await writeFile(join(packRoot, "sources", "source-manifest.json"), stringifyJson({
      schemaVersion: 1,
      sourceOfTruth: "openkb",
      openkbSources: [
        "compiled/controls/annex_7_2_mapping.jsonl",
        "raw/legal/other_profile.jsonl"
      ],
      sourceProfileReferences: [
        {
          path: "raw/legal/7의2_ISMS-P_인증기준_항목_목록.jsonl",
          purpose: "source-profile cross-check"
        }
      ],
      privateOverlaysIncluded: false
    }));

    const result = await validatePack(packRoot);

    assert.equal(result.valid, false);
    assert.match(result.issues.join("\n"), /must not list raw legal profile rows as direct openkbSources/);
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

test("CLI installs a selected pack into workspace controls", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-pack-install-cli-"));
  try {
    const result = spawnSync(process.execPath, [
      join(process.cwd(), "dist", "cli.js"),
      "pack",
      "install",
      join(process.cwd(), "packs", "isms-p-core-v0")
    ], {
      cwd: dir,
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.installedControls, 3);
    assert.deepEqual(parsed.skippedControls, []);
    assert.equal(
      await readdir(join(dir, "controls")).then((names) => names.filter((name) => name.endsWith(".json")).length),
      3
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI installs the default pack from the repository workspace", () => {
  const result = spawnSync(process.execPath, [
    join(process.cwd(), "dist", "cli.js"),
    "pack",
    "install",
    "--overwrite"
  ], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");

  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.packRoot, join(process.cwd(), "packs", "isms-p-core-v0"));
  assert.equal(parsed.outputDir, join(process.cwd(), "controls"));
  assert.equal(parsed.installedControls, 3);
  assert.deepEqual(parsed.skippedControls, []);
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
