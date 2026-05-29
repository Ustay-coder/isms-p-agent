import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { generateReports } from "../../src/commands/report.js";
import { stringifyJson } from "../../src/core/json.js";
import { renderEvidenceMap } from "../../src/reports/evidence-map.js";
import type { ControlAnalysisResult } from "../../src/schemas/analysis.js";
import type { ControlKnowledge } from "../../src/schemas/control.js";
import type { ScanResult } from "../../src/schemas/scan.js";

test("generateReports writes deterministic backlog, control gap, and evidence map markdown", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-report-"));
  try {
    await mkdir(join(dir, "controls"), { recursive: true });
    await mkdir(join(dir, "scans"), { recursive: true });

    await writeFile(join(dir, "controls", "2.5.3.json"), stringifyJson(control()));
    await writeFile(join(dir, "controls", "2.10.4.json"), stringifyJson(control({
      control_id: "2.10.4",
      title: "클라우드 보안",
      observable_signals: ["waf"],
      required_operating_practices: ["waf rule review"],
      required_evidence: ["waf change record"],
      source_refs: [{ sourcePath: "raw/cloud.md", sha256: "def456", excerpt: "waf" }]
    })));
    await writeFile(join(dir, "scans", "scan-2026-05-28T00-00-00-000Z.json"), stringifyJson(scanResult()));

    const result = await generateReports(dir);

    assert.deepEqual(result.outputPaths, {
      backlog: join(dir, "reports", "backlog.md"),
      controlGapReport: join(dir, "reports", "control-gap-report.md"),
      evidenceMap: join(dir, "reports", "evidence-map.md")
    });

    for (const path of Object.values(result.outputPaths)) {
      assert.equal((await stat(path)).isFile(), true);
    }

    const backlog = await readFile(result.outputPaths.backlog, "utf8");
    assert.match(backlog, /## this week/);
    assert.match(backlog, /## this month/);
    assert.match(backlog, /## before certification readiness review/);
    assert.match(backlog, /candidate evidence/i);
    assert.doesNotMatch(backlog, /final audit evidence/i);
    assert.match(backlog, /needs_confirmation/);
    assert.match(backlog, /Collect missing scanner inputs/i);

    const controlGap = await readFile(result.outputPaths.controlGapReport, "utf8");
    assert.match(controlGap, /## 2\.5\.3 사용자 인증/);
    assert.match(controlGap, /\*\*Status:\*\* partial/);
    assert.match(controlGap, /\*\*Missing items:\*\*/);
    assert.match(controlGap, /\*\*Recommended actions:\*\*/);
    assert.match(controlGap, /\*\*Confidence:\*\* medium/);
    assert.match(controlGap, /\*\*Basis:\*\* observed/);
    assert.match(controlGap, /\*\*Source refs:\*\*/);
    assert.match(controlGap, /candidate evidence/i);
    assert.match(controlGap, /## 2\.10\.4 클라우드 보안/);
    assert.match(controlGap, /\*\*Status:\*\* needs_confirmation/);

    const evidenceMap = await readFile(result.outputPaths.evidenceMap, "utf8");
    assert.match(evidenceMap, /# Evidence Map/);
    assert.match(evidenceMap, /candidate evidence/i);
    assert.match(evidenceMap, /Which control it supports/);
    assert.match(evidenceMap, /Where the evidence might come from/);
    assert.match(evidenceMap, /Whether it already exists/);
    assert.match(evidenceMap, /Operation or configuration/);
    assert.match(evidenceMap, /Human review needed/);
    assert.match(evidenceMap, /configuration only/);
    assert.match(evidenceMap, /operation/);
    assert.doesNotMatch(evidenceMap, /final audit evidence/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generateReports selects the latest scan by generatedAt instead of filename order", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-report-latest-scan-"));
  try {
    await mkdir(join(dir, "controls"), { recursive: true });
    await mkdir(join(dir, "scans"), { recursive: true });

    await writeFile(join(dir, "controls", "2.5.3.json"), stringifyJson(control()));
    await writeFile(join(dir, "scans", "scan-2026-05-27T00-00-00-000Z.json"), stringifyJson(scanResult({
      generatedAt: "2026-05-27T00:00:00.000Z",
      signals: []
    })));
    await writeFile(join(dir, "scans", "local-2026-05-28T00-00-00-000Z.json"), stringifyJson(scanResult({
      generatedAt: "2026-05-28T00:00:00.000Z",
      signals: [
        {
          id: "newer-local-branch-protection",
          source: "github",
          basis: "observed",
          summary: "Newer local scan saw GitHub branch protection",
          paths: [".github/settings.yml"],
          metadata: {}
        }
      ]
    })));

    const result = await generateReports(dir);
    const controlGap = await readFile(result.outputPaths.controlGapReport, "utf8");

    assert.match(controlGap, /Newer local scan saw GitHub branch protection/);
    assert.match(controlGap, /\*\*Status:\*\* partial/);
    assert.doesNotMatch(controlGap, /\*\*Status:\*\* needs_confirmation/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("renderEvidenceMap marks not applicable controls without implying missing candidate evidence", () => {
  const markdown = renderEvidenceMap([
    analysisResult({
      status: "not_applicable",
      observed_evidence: ["Service does not use R2 storage"],
      missing: [],
      recommended_actions: [],
      required_evidence: ["R2 access review record"],
      confidence: "high",
      judgment_basis: "user-confirmed"
    })
  ]);

  assert.match(markdown, /not applicable/i);
  assert.match(markdown, /Service does not use R2 storage/);
  assert.doesNotMatch(markdown, /not confirmed/i);
  assert.doesNotMatch(markdown, /missing/i);
  assert.doesNotMatch(markdown, /Control owner-defined candidate evidence/i);
});

test("connector failure uncertainty remains reportable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-report-connector-failure-"));
  try {
    await mkdir(join(dir, "controls"), { recursive: true });
    await mkdir(join(dir, "scans"), { recursive: true });

    await writeFile(join(dir, "controls", "2.10.4.json"), stringifyJson(control({
      control_id: "2.10.4",
      title: "클라우드 보안",
      observable_signals: ["Cloudflare WAF"],
      required_operating_practices: ["waf rule review"],
      required_evidence: ["waf change record"],
      source_refs: [{ sourcePath: "raw/cloud.md", sha256: "def456", excerpt: "waf" }]
    })));
    await writeFile(join(dir, "scans", "scan-2026-05-28T00-00-00-000Z.json"), stringifyJson(scanResult({
      signals: [
        {
          id: "cloudflare:waf",
          source: "cloudflare",
          basis: "needs_confirmation",
          summary: "Cloudflare WAF API failure requires confirmation",
          paths: [],
          metadata: { zone: "example.com" }
        }
      ]
    })));

    const result = await generateReports(dir);
    const controlGap = await readFile(result.outputPaths.controlGapReport, "utf8");
    const evidenceMap = await readFile(result.outputPaths.evidenceMap, "utf8");

    assert.match(controlGap, /\*\*Status:\*\* needs_confirmation/);
    assert.match(controlGap, /Cloudflare WAF API failure requires confirmation/);
    assert.match(evidenceMap, /Cloudflare WAF API failure requires confirmation/);
    assert.match(evidenceMap, /not confirmed/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reports include evidence review overlay decisions when present", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-report-evidence-review-"));
  try {
    await mkdir(join(dir, "controls"), { recursive: true });
    await mkdir(join(dir, "scans"), { recursive: true });
    await mkdir(join(dir, "evidence"), { recursive: true });
    await mkdir(join(dir, "reviews"), { recursive: true });

    await writeFile(join(dir, "controls", "2.5.3.json"), stringifyJson(control({
      control_id: "ISMS-P-2.5.3",
      required_evidence: ["MFA and session configuration record"]
    })));
    await writeFile(join(dir, "scans", "scan-2026-05-28T00-00-00-000Z.json"), stringifyJson(scanResult()));
    await writeFile(join(dir, "evidence", "index.jsonl"), JSON.stringify({
      evidence_id: "ev_auth_mfa",
      title: "MFA configuration candidate",
      evidence_type: "configuration_export",
      classification: "confidential",
      lifecycle_status: "candidate",
      origin: "manual",
      supports: ["ISMS-P-2.5.3.admin-mfa"],
      locator: { kind: "workspace_path", value: "project/evaluation/specs/Auth_Spec.md" },
      summary: "MFA configuration and session setting evidence candidate.",
      collected_at: "2026-05-28T00:00:00.000Z",
      review_required: true,
      metadata: {}
    }) + "\n");
    await writeFile(join(dir, "reviews", "evidence-review.jsonl"), JSON.stringify({
      schemaVersion: 1,
      reviewed_at: "2026-05-28T01:00:00.000Z",
      evidence_id: "ev_auth_mfa",
      requirement_id: "ISMS-P-2.5.3.admin-mfa",
      decision: "needs_followup",
      reviewer: "security-owner",
      rationale: "Production enforcement record is still required."
    }) + "\n");

    const result = await generateReports(dir);
    const controlGap = await readFile(result.outputPaths.controlGapReport, "utf8");
    const evidenceMap = await readFile(result.outputPaths.evidenceMap, "utf8");

    assert.match(controlGap, /\*\*Evidence review overlay:\*\*/);
    assert.match(controlGap, /ISMS-P-2\.5\.3\.admin-mfa/);
    assert.match(controlGap, /needs_followup/);
    assert.match(controlGap, /Production enforcement record is still required/);
    assert.match(evidenceMap, /Review overlay decision/);
    assert.match(evidenceMap, /ev_auth_mfa/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

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

test("generateReports fails clearly when controls or scans are missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-report-empty-"));
  try {
    await mkdir(join(dir, "controls"), { recursive: true });
    await mkdir(join(dir, "scans"), { recursive: true });

    await assert.rejects(generateReports(dir), /No control JSON files found in controls\//);

    await writeFile(join(dir, "controls", "2.5.3.json"), stringifyJson(control()));
    await assert.rejects(generateReports(dir), /No scan JSON files found in scans\//);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

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
        id: "cloudflare-waf-confirmation",
        source: "cloudflare",
        basis: "needs_confirmation",
        summary: "Cloudflare WAF requires API confirmation",
        paths: [],
        metadata: { zone: "example.com" }
      },
      {
        id: "access-review-doc",
        source: "local-docs",
        basis: "document-backed",
        summary: "Change approval record is documented for operation",
        paths: ["project/change-approval.md"],
        metadata: {}
      }
    ],
    ...overrides
  };
}

function analysisResult(overrides: Partial<ControlAnalysisResult> = {}): ControlAnalysisResult {
  return {
    control_id: "2.10.4",
    title: "클라우드 보안",
    status: "partial",
    observed_evidence: [],
    missing: [],
    recommended_actions: [],
    required_evidence: [],
    confidence: "medium",
    judgment_basis: "observed",
    source_refs: [{ sourcePath: "raw/cloud.md", sha256: "def456", excerpt: "cloud" }],
    ...overrides
  };
}
