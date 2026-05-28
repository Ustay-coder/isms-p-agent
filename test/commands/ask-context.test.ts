import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildAskContext } from "../../src/commands/ask-context.js";
import { renderAskContextMarkdown } from "../../src/ask/output.js";
import { stringifyJson } from "../../src/core/json.js";
import type { ControlKnowledge } from "../../src/schemas/control.js";
import type { ScanResult } from "../../src/schemas/scan.js";

test("buildAskContext prioritizes exact control ID questions", async () => {
  const dir = await workspace();
  try {
    const context = await buildAskContext(dir, "2.5.3 사용자 인증 상태 알려줘");

    assert.equal(context.schemaVersion, 1);
    assert.equal(context.question, "2.5.3 사용자 인증 상태 알려줘");
    assert.equal(context.intent, "control_status");
    assert.equal(context.relevantControls[0]?.control_id, "2.5.3");
    assert.equal(context.relevantControls[0]?.status, "partial");
    assert.match(context.facts.join("\n"), /2\.5\.3 사용자 인증 status is partial/);
    assert.match(context.relevantReports.join("\n"), /reports\/control-gap-report\.md/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("buildAskContext classifies Korean evidence questions", async () => {
  const dir = await workspace();
  try {
    const context = await buildAskContext(dir, "사용자 인증 증적은 무엇이 부족해?");

    assert.equal(context.intent, "evidence");
    assert.equal(context.relevantControls[0]?.control_id, "2.5.3");
    assert.ok(context.answerConstraints.some((item) => item.includes("candidate evidence")));
    assert.ok(context.relevantControls[0]?.required_evidence.includes("access review record"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("buildAskContext prioritizes unresolved items for backlog questions", async () => {
  const dir = await workspace();
  try {
    const context = await buildAskContext(dir, "이번 주에 먼저 처리할 ISMS-P 작업은?");

    assert.equal(context.intent, "backlog");
    assert.deepEqual(
      context.relevantControls.map((control) => control.status),
      ["partial", "needs_confirmation"]
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("renderAskContextMarkdown includes constraints and candidate evidence language", async () => {
  const dir = await workspace();
  try {
    const context = await buildAskContext(dir, "2.5.3 사용자 인증 상태 알려줘");
    const markdown = renderAskContextMarkdown(context);

    assert.match(markdown, /# Ask Context/);
    assert.match(markdown, /candidate evidence/i);
    assert.match(markdown, /Do not claim certification readiness/i);
    assert.match(markdown, /## Relevant Controls/);
    assert.match(markdown, /2\.5\.3 사용자 인증/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("buildAskContext fails clearly when controls or scans are missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-ask-empty-"));
  try {
    await mkdir(join(dir, "controls"), { recursive: true });
    await mkdir(join(dir, "scans"), { recursive: true });

    await assert.rejects(buildAskContext(dir, "무엇이 부족해?"), /No control JSON files found in controls\//);

    await writeFile(join(dir, "controls", "2.5.3.json"), stringifyJson(control()));
    await assert.rejects(buildAskContext(dir, "무엇이 부족해?"), /No scan JSON files found in scans\//);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI prints ask-context JSON for natural language questions", async () => {
  const dir = await workspace();
  try {
    const result = spawnSync(
      process.execPath,
      [join(process.cwd(), "dist", "cli.js"), "ask-context", "2.5.3 사용자 인증 상태 알려줘"],
      {
        cwd: dir,
        encoding: "utf8"
      }
    );

    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    const context = JSON.parse(result.stdout) as { intent: string; relevantControls: Array<{ control_id: string }> };
    assert.equal(context.intent, "control_status");
    assert.equal(context.relevantControls[0]?.control_id, "2.5.3");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

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

async function workspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-ask-"));
  await mkdir(join(dir, "controls"), { recursive: true });
  await mkdir(join(dir, "scans"), { recursive: true });

  await writeFile(join(dir, "controls", "2.5.3.json"), stringifyJson(control()));
  await writeFile(join(dir, "controls", "2.6.1.json"), stringifyJson(control({
    control_id: "2.6.1",
    title: "접근권한 검토",
    observable_signals: ["inactive user"],
    required_operating_practices: ["quarterly access review"],
    required_evidence: ["access review approval"],
    source_refs: [{ sourcePath: "raw/access.md", sha256: "def456", excerpt: "access review" }]
  })));
  await writeFile(join(dir, "scans", "scan-2026-05-28T00-00-00-000Z.json"), stringifyJson(scanResult()));

  return dir;
}

function control(overrides: Partial<ControlKnowledge> = {}): ControlKnowledge {
  return {
    control_id: "2.5.3",
    title: "사용자 인증",
    domain: "보호대책 요구사항",
    category: "인증 및 권한관리",
    requirement: "Operate authentication controls.",
    intent: "Confirm authentication control operation.",
    applicability_questions: [],
    observable_signals: ["branch protection"],
    required_operating_practices: ["access review"],
    required_evidence: ["access review record"],
    common_defects: ["No periodic review"],
    automation_potential: "partial",
    human_review_required: true,
    source_refs: [{ sourcePath: "raw/isms.md", sha256: "abc123", excerpt: "authentication" }],
    ...overrides
  };
}

function scanResult(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    schemaVersion: 1,
    generatedAt: "2026-05-28T00:00:00.000Z",
    signals: [
      {
        id: "github-branch-protection",
        source: "github",
        basis: "observed",
        summary: "GitHub branch protection is enabled",
        paths: [".github/settings.yml"],
        metadata: { repository: "owner/repo" }
      },
      {
        id: "mfa-doc",
        source: "local-docs",
        basis: "document-backed",
        summary: "Access review is documented for account authentication operation",
        paths: ["project/access-review.md"],
        metadata: {}
      }
    ],
    ...overrides
  };
}
