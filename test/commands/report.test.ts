import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { generateReports } from "../../src/commands/report.js";
import { stringifyJson } from "../../src/core/json.js";
import type { ControlKnowledge } from "../../src/schemas/control.js";
import type { EvidenceItem } from "../../src/schemas/evidence.js";
import type { ScanResult } from "../../src/schemas/scan.js";

test("generateReports public mode omits accepted review private evidence paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-report-public-private-evidence-"));
  try {
    await mkdir(join(dir, "controls"), { recursive: true });
    await mkdir(join(dir, "scans"), { recursive: true });
    await mkdir(join(dir, "evidence"), { recursive: true });
    await mkdir(join(dir, "evidence", "private", "ISMS-P-2.10.2"), { recursive: true });
    await mkdir(join(dir, "reviews"), { recursive: true });
    await writeFile(join(dir, "evidence", "private", "ISMS-P-2.10.2", "security-review.md"), "# Private review\n");
    await writeFile(join(dir, "controls", "ISMS-P-2.10.2.json"), stringifyJson(control()));
    await writeFile(join(dir, "scans", "scan.json"), stringifyJson(scan()));
    await writeFile(join(dir, "evidence", "index.jsonl"), JSON.stringify(evidence()) + "\n");
    await writeFile(join(dir, "reviews", "evidence-review.jsonl"), JSON.stringify({
      schemaVersion: 1,
      reviewed_at: "2026-05-29T00:00:00.000Z",
      evidence_id: "ev_cloudflare_security_review",
      requirement_id: "ISMS-P-2.10.2.cloudflare-config-export",
      decision: "accepted",
      reviewer: "security-owner",
      rationale: "Private rationale names the internal review file security-review.md.",
      private_evidence_path: "evidence/private/ISMS-P-2.10.2/security-review.md"
    }) + "\n");

    const result = await generateReports(dir, { public: true });
    const report = await readFile(result.outputPaths.controlGapReport, "utf8");
    const evidenceMap = await readFile(result.outputPaths.evidenceMap, "utf8");
    const serialized = `${report}\n${evidenceMap}`;

    assert.match(serialized, /Private review rationale omitted from public report/);
    assert.doesNotMatch(serialized, /evidence\/private/);
    assert.doesNotMatch(serialized, /security-review\.md/);
    assert.doesNotMatch(serialized, /Private rationale names/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function control(): ControlKnowledge {
  return {
    control_id: "ISMS-P-2.10.2",
    title: "클라우드 보안",
    domain: "보호대책 요구사항",
    category: "시스템 및 서비스 보안관리",
    requirement: "Cloud security review evidence must be reviewed.",
    intent: "Confirm Cloudflare security review evidence.",
    applicability_questions: ["Does the service use Cloudflare?"],
    observable_signals: ["Cloudflare"],
    required_operating_practices: ["cloud security review"],
    required_evidence: ["periodic cloud security review record"],
    common_defects: ["scanner output accepted without operating review"],
    automation_potential: "partial",
    human_review_required: true,
    source_refs: [
      {
        sourcePath: "compiled/evidence/evidence_requirements.jsonl",
        sha256: "openkb-managed"
      }
    ],
    requirements: [
      {
        requirement_id: "ISMS-P-2.10.2.cloudflare-config-export",
        control_id: "ISMS-P-2.10.2",
        title: "Cloudflare configuration review",
        kind: "operation_record",
        required: true,
        evidence_types: ["configuration_export"],
        source_refs: [
          {
            sourcePath: "compiled/evidence/evidence_requirements.jsonl",
            sha256: "openkb-managed"
          }
        ]
      }
    ]
  };
}

function scan(): ScanResult {
  return {
    schemaVersion: 1,
    generatedAt: "2026-05-29T00:00:00.000Z",
    signals: [
      {
        id: "cloudflare-zone",
        source: "cloudflare",
        basis: "observed",
        summary: "Cloudflare zone metadata is available.",
        paths: [],
        metadata: {
          requirement_ids: ["ISMS-P-2.10.2.cloudflare-config-export"]
        }
      }
    ]
  };
}

function evidence(): EvidenceItem {
  return {
    evidence_id: "ev_cloudflare_security_review",
    title: "Cloudflare security review",
    evidence_type: "configuration_export",
    classification: "confidential",
    lifecycle_status: "candidate",
    origin: "manual",
    supports: ["ISMS-P-2.10.2.cloudflare-config-export"],
    locator: {
      kind: "workspace_path",
      value: "evidence/private/ISMS-P-2.10.2/security-review.md"
    },
    summary: "Private Cloudflare security review exists.",
    collected_at: "2026-05-29T00:00:00.000Z",
    review_required: true,
    metadata: {}
  };
}
