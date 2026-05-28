import assert from "node:assert/strict";
import test from "node:test";
import { analyzeControls } from "../../src/analyzer/gap.js";
import type { ControlKnowledge } from "../../src/schemas/control.js";
import type { ScanSignal } from "../../src/schemas/scan.js";

test("matching observed technical signals are partial without operating evidence", () => {
  const [result] = analyzeControls(
    [control({ observable_signals: ["branch protection"], required_operating_practices: ["change review"] })],
    [signal({ basis: "observed", summary: "GitHub branch protection is enabled" })]
  );

  assert.equal(result?.status, "partial");
  assert.equal(result?.confidence, "medium");
  assert.equal(result?.judgment_basis, "observed");
  assert.match(result?.observed_evidence.join("\n") ?? "", /branch protection/i);
  assert.match(result?.missing.join("\n") ?? "", /change review/i);
});

test("missing operating-practice evidence prevents satisfied even with required evidence terms", () => {
  const [result] = analyzeControls(
    [
      control({
        observable_signals: ["dependabot"],
        required_operating_practices: ["monthly dependency review"],
        required_evidence: ["dependency review record"]
      })
    ],
    [signal({ basis: "observed", summary: "Dependabot configuration is present" })]
  );

  assert.equal(result?.status, "partial");
  assert.notEqual(result?.status, "satisfied");
  assert.deepEqual(result?.missing, ["monthly dependency review", "dependency review record"]);
});

test("technical and matching document-backed operating evidence can be satisfied", () => {
  const [result] = analyzeControls(
    [
      control({
        observable_signals: ["incident runbook"],
        required_operating_practices: ["incident review"],
        required_evidence: ["incident review record"]
      })
    ],
    [
      signal({ basis: "observed", summary: "Incident runbook configuration exists" }),
      signal({
        basis: "document-backed",
        source: "local-docs",
        summary: "Incident Review policy and incident review record headings are present"
      })
    ]
  );

  assert.equal(result?.status, "satisfied");
  assert.equal(result?.confidence, "high");
  assert.equal(result?.judgment_basis, "document-backed");
});

test("missing scanner inputs produce needs_confirmation", () => {
  const [result] = analyzeControls([control({ observable_signals: ["waf"] })], []);

  assert.equal(result?.status, "needs_confirmation");
  assert.equal(result?.confidence, "low");
  assert.equal(result?.judgment_basis, "inferred");
  assert.match(result?.missing.join("\n") ?? "", /scanner coverage/i);
});

test("matching needs-confirmation scanner signals produce needs_confirmation", () => {
  const [result] = analyzeControls(
    [control({ observable_signals: ["branch protection"] })],
    [
      signal({ basis: "needs_confirmation", summary: "GitHub branch protection requires API confirmation" }),
      signal({ basis: "observed", source: "local-repo", summary: "Local package metadata is present" })
    ]
  );

  assert.equal(result?.status, "needs_confirmation");
  assert.equal(result?.confidence, "low");
});

test("irrelevant controls are not_applicable only with explicit applicability answers", () => {
  const [unanswered] = analyzeControls([control({ applicability_questions: ["Do you use R2?"] })], [
    signal({ basis: "observed", summary: "Local package metadata is present" })
  ]);
  const [answered] = analyzeControls(
    [control({ applicability_questions: ["Do you use R2?"] })],
    [signal({ basis: "observed", summary: "Local package metadata is present" })],
    {
      "2.5.3": {
        applicable: false,
        basis: "user-confirmed",
        reason: "Service does not use R2 storage"
      }
    }
  );

  assert.equal(unanswered?.status, "gap");
  assert.equal(answered?.status, "not_applicable");
  assert.equal(answered?.judgment_basis, "user-confirmed");
  assert.deepEqual(answered?.observed_evidence, ["Service does not use R2 storage"]);
});

test("clearly unsupported applicability inputs can mark a control not applicable", () => {
  const [result] = analyzeControls([control({ applicability_questions: ["Do you use Cloudflare Workers?"] })], [
    signal({
      basis: "observed",
      source: "cloudflare",
      summary: "No Cloudflare Workers services are configured",
      metadata: { present: false, service: "cloudflare workers" }
    })
  ]);

  assert.equal(result?.status, "not_applicable");
  assert.equal(result?.judgment_basis, "observed");
});

test("judgment basis is preserved from the strongest matching signal", () => {
  const [result] = analyzeControls(
    [control({ observable_signals: ["access review"], required_operating_practices: [] })],
    [signal({ basis: "document-backed", source: "local-docs", summary: "Access review procedure is documented" })]
  );

  assert.equal(result?.status, "partial");
  assert.equal(result?.judgment_basis, "document-backed");
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
    observable_signals: ["authentication"],
    required_operating_practices: ["access review"],
    required_evidence: [],
    common_defects: [],
    automation_potential: "partial",
    human_review_required: true,
    source_refs: [{ sourcePath: "raw/isms.md", sha256: "abc123", excerpt: "authentication" }],
    ...overrides
  };
}

function signal(overrides: Partial<ScanSignal> = {}): ScanSignal {
  return {
    id: "signal-1",
    source: "github",
    basis: "observed",
    summary: "Authentication setting is enabled",
    paths: [".github/settings.yml"],
    metadata: {},
    ...overrides
  };
}
