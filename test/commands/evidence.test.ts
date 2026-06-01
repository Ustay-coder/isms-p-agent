import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { addManualEvidence, exportPublicEvidence, indexEvidenceFromScan, reviewCloudflareEvidence, reviewEvidence, validateEvidence } from "../../src/commands/evidence.js";
import { stringifyJson } from "../../src/core/json.js";
import type { EvidenceItem } from "../../src/schemas/evidence.js";
import type { ScanResult } from "../../src/schemas/scan.js";

test("validateEvidence passes an empty workspace and reports warnings only", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-"));
  try {
    const result = await validateEvidence(dir, { public: true });

    assert.equal(result.valid, true);
    assert.deepEqual(result.issues, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("validateEvidence rejects secret and personal-data evidence in public mode", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-"));
  try {
    await mkdir(join(dir, "evidence"), { recursive: true });
    await writeFile(join(dir, "evidence", "index.jsonl"), [
      JSON.stringify(evidence({ evidence_id: "ev_secret", classification: "secret" })),
      JSON.stringify(evidence({ evidence_id: "ev_pii", classification: "personal_data" }))
    ].join("\n") + "\n");

    const result = await validateEvidence(dir, { public: true });

    assert.equal(result.valid, false);
    assert.match(result.issues.join("\n"), /ev_secret/);
    assert.match(result.issues.join("\n"), /ev_pii/);
    assert.match(result.issues.join("\n"), /cannot be included in public validation/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("validateEvidence rejects public evidence metadata that looks like a credential", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-"));
  try {
    await mkdir(join(dir, "evidence"), { recursive: true });
    await writeFile(join(dir, "evidence", "index.jsonl"), JSON.stringify(evidence({
      evidence_id: "ev_token",
      metadata: {
        token: "redacted-token-placeholder",
        safeName: "Cloudflare config export"
      }
    })) + "\n");

    const result = await validateEvidence(dir, { public: true });

    assert.equal(result.valid, false);
    assert.match(result.issues.join("\n"), /credential-like metadata/);
    assert.match(result.issues.join("\n"), /ev_token/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("validateEvidence rejects public evidence metadata that contains private or local paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-private-path-metadata-"));
  try {
    const localPath = ["", "Users", "example", "private", "review.md"].join("/");
    await mkdir(join(dir, "evidence"), { recursive: true });
    await writeFile(join(dir, "evidence", "index.jsonl"), [
      JSON.stringify(evidence({
        evidence_id: "ev_private_path_metadata",
        metadata: {
          note: "see evidence/private/ISMS-P-2.5.3/review.md"
        }
      })),
      JSON.stringify(evidence({
        evidence_id: "ev_local_path_metadata",
        metadata: {
          note: `source ${localPath}`
        }
      }))
    ].join("\n") + "\n");

    const result = await validateEvidence(dir, { public: true });

    assert.equal(result.valid, false);
    assert.match(result.issues.join("\n"), /ev_private_path_metadata/);
    assert.match(result.issues.join("\n"), /private path metadata at note/);
    assert.match(result.issues.join("\n"), /ev_local_path_metadata/);
    assert.match(result.issues.join("\n"), /local path metadata at note/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("validateEvidence allows public-safe Cloudflare permission status metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-cloudflare-permission-"));
  try {
    await mkdir(join(dir, "evidence"), { recursive: true });
    await writeFile(join(dir, "evidence", "index.jsonl"), JSON.stringify(evidence({
      evidence_id: "ev_cloudflare_dns_permission",
      classification: "confidential",
      metadata: {
        product: "dns",
        permission_status: "needs_permission_or_confirmation",
        endpoint: "/zones/{zone_id}/dns_records"
      }
    })) + "\n");

    const result = await validateEvidence(dir, { public: true });

    assert.equal(result.valid, true);
    assert.doesNotMatch(result.issues.join("\n"), /credential-like metadata/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("validateEvidence warns when accepted evidence is expired", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-"));
  try {
    await mkdir(join(dir, "evidence"), { recursive: true });
    await writeFile(join(dir, "evidence", "index.jsonl"), JSON.stringify(evidence({
      evidence_id: "ev_expired",
      lifecycle_status: "accepted",
      valid_until: "2020-01-01T00:00:00.000Z"
    })) + "\n");

    const result = await validateEvidence(dir, { public: true });

    assert.equal(result.valid, true);
    assert.match(result.warnings.join("\n"), /ev_expired/);
    assert.match(result.warnings.join("\n"), /expired/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("validateEvidence warns when evidence has no requirement mapping", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-"));
  try {
    await mkdir(join(dir, "evidence"), { recursive: true });
    await writeFile(join(dir, "evidence", "index.jsonl"), JSON.stringify(evidence({
      evidence_id: "ev_unmapped",
      supports: []
    })) + "\n");

    const result = await validateEvidence(dir, { public: true });

    assert.equal(result.valid, true);
    assert.match(result.warnings.join("\n"), /ev_unmapped/);
    assert.match(result.warnings.join("\n"), /no requirement mapping/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("validateEvidence treats review overlay records as requirement mappings", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-review-mapping-"));
  try {
    await mkdir(join(dir, "evidence"), { recursive: true });
    await mkdir(join(dir, "reviews"), { recursive: true });
    await writeFile(join(dir, "evidence", "index.jsonl"), JSON.stringify(evidence({
      evidence_id: "ev_review_mapped",
      supports: []
    })) + "\n");
    await writeFile(join(dir, "reviews", "evidence-review.jsonl"), JSON.stringify({
      schemaVersion: 1,
      reviewed_at: "2026-05-28T01:00:00.000Z",
      evidence_id: "ev_review_mapped",
      requirement_id: "ISMS-P-2.5.3.admin-mfa",
      decision: "needs_followup",
      rationale: "Production evidence is still required."
    }) + "\n");

    const result = await validateEvidence(dir, { public: true });

    assert.equal(result.valid, true);
    assert.doesNotMatch(result.warnings.join("\n"), /no requirement mapping/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("indexEvidenceFromScan creates stable candidate evidence without copying scan paths into metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-index-"));
  try {
    await mkdir(join(dir, "scans"), { recursive: true });
    const scanPath = join(dir, "scans", "scan-2026-05-28T00-00-00-000Z.json");
    await writeFile(scanPath, stringifyJson(scanResult()));

    const first = await indexEvidenceFromScan(dir, { fromScan: scanPath });
    const second = await indexEvidenceFromScan(dir, { fromScan: scanPath });

    assert.equal(first.indexedEvidence, 2);
    assert.equal(second.indexedEvidence, 2);
    assert.equal(first.outputPath, join(dir, "evidence", "index.jsonl"));

    const rows = (await readFile(first.outputPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as EvidenceItem);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => row.evidence_id), rows.map((row) => row.evidence_id).sort());
    const authEvidence = rows.find((row) => row.evidence_id === "ev_scan_local_docs_auth_mfa");
    assert.equal(authEvidence?.origin, "scan");
    assert.equal(authEvidence?.lifecycle_status, "candidate");
    assert.equal(authEvidence?.locator.kind, "scan_signal");
    assert.deepEqual(authEvidence?.supports, ["ISMS-P-2.5.3.admin-mfa"]);
    assert.equal("paths" in (authEvidence?.metadata ?? {}), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("indexEvidenceFromScan preserves existing non-scan evidence items", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-index-preserve-"));
  try {
    await mkdir(join(dir, "scans"), { recursive: true });
    await mkdir(join(dir, "evidence"), { recursive: true });
    const manualEvidence = evidence({ evidence_id: "ev_manual_policy", origin: "manual" });
    await writeFile(join(dir, "evidence", "index.jsonl"), JSON.stringify(manualEvidence) + "\n");
    const scanPath = join(dir, "scans", "scan-2026-05-28T00-00-00-000Z.json");
    await writeFile(scanPath, stringifyJson(scanResult()));

    const result = await indexEvidenceFromScan(dir, { fromScan: scanPath });

    const rows = (await readFile(result.outputPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as EvidenceItem);
    assert.equal(rows.some((row) => row.evidence_id === "ev_manual_policy" && row.origin === "manual"), true);
    assert.equal(rows.some((row) => row.evidence_id === "ev_scan_local_docs_auth_mfa" && row.origin === "scan"), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("indexEvidenceFromScan preserves manual evidence added with addManualEvidence after scanner re-index", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-index-preserve-manual-"));
  try {
    await mkdir(join(dir, "scans"), { recursive: true });
    const privatePath = join(dir, "evidence", "private", "ISMS-P-2.5.3", "authentication-policy", "2026-Q2.md");
    await mkdir(join(privatePath, ".."), { recursive: true });
    await writeFile(privatePath, "# Authentication policy\n\nReviewed for 2026 Q2.\n");
    const manual = await addManualEvidence(dir, {
      id: "ev_manual_auth_policy_2026_q2",
      title: "Authentication policy 2026 Q2",
      evidenceType: "policy_document",
      classification: "internal",
      supports: ["ISMS-P-2.5.3.authentication-policy"],
      privateEvidencePath: "evidence/private/ISMS-P-2.5.3/authentication-policy/2026-Q2.md",
      summary: "Authentication policy reviewed for 2026 Q2.",
      collectedAt: new Date("2026-05-29T00:00:00.000Z")
    });
    const scanPath = join(dir, "scans", "scan-2026-05-28T00-00-00-000Z.json");
    await writeFile(scanPath, stringifyJson(scanResult()));

    await indexEvidenceFromScan(dir, { fromScan: scanPath });
    const result = await indexEvidenceFromScan(dir, { fromScan: scanPath });

    assert.equal(result.indexedEvidence, 3);
    const content = await readFile(result.outputPath, "utf8");
    const rows = content.trim().split("\n").map((line) => JSON.parse(line) as EvidenceItem);
    const preserved = rows.find((row) => row.evidence_id === "ev_manual_auth_policy_2026_q2");
    assert.equal(preserved?.origin, "manual");
    assert.equal(preserved?.lifecycle_status, "needs_review");
    assert.equal(preserved?.review_required, true);
    assert.deepEqual(preserved?.locator, {
      kind: "external_reference",
      value: "ev_manual_auth_policy_2026_q2"
    });
    assert.equal(preserved?.content_sha256, manual.item.content_sha256);
    assert.equal(preserved?.metadata.private_evidence_present, true);
    assert.equal(rows.some((row) => row.evidence_id === "ev_scan_local_docs_auth_mfa" && row.origin === "scan"), true);
    assert.doesNotMatch(content, /evidence\/private/);
    assert.doesNotMatch(content, /2026-Q2\.md/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("indexEvidenceFromScan keeps only safe Cloudflare connector metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-index-cloudflare-"));
  try {
    await mkdir(join(dir, "scans"), { recursive: true });
    const scanPath = join(dir, "scans", "scan-2026-05-28T00-00-00-000Z.json");
    await writeFile(scanPath, stringifyJson(scanResult({
      signals: [
        {
          id: "cloudflare:hyperdrive",
          source: "cloudflare",
          basis: "observed",
          summary: "Cloudflare Hyperdrive metadata shows 1 config(s).",
          paths: [],
          metadata: {
            product: "hyperdrive",
            endpoint: "/accounts/{account_id}/hyperdrive/configs",
            permission_status: "available",
            requirement_ids: ["ISMS-P-2.10.2.cloudflare-config-export"],
            available: true,
            count: 1,
            sensitivity: "internal"
          }
        }
      ]
    })));

    const result = await indexEvidenceFromScan(dir, { fromScan: scanPath });
    const rows = (await readFile(result.outputPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as EvidenceItem);
    const indexed = rows.find((row) => row.evidence_id === "ev_scan_cloudflare_cloudflare_hyperdrive");

    assert.equal(indexed?.metadata.product, "hyperdrive");
    assert.equal(indexed?.metadata.count, 1);
    assert.equal(indexed?.classification, "confidential");
    assert.doesNotMatch(JSON.stringify(indexed), /private-db|password|bucket|route|account_123/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reviewCloudflareEvidence dry run proposes records without writing review files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-review-cloudflare-dry-run-"));
  try {
    await mkdir(join(dir, "evidence"), { recursive: true });
    await writeFile(join(dir, "evidence", "index.jsonl"), cloudflareEvidenceRows().map((row) => JSON.stringify(row)).join("\n") + "\n");

    const result = await reviewCloudflareEvidence(dir, {
      dryRun: true,
      reviewer: "security-owner",
      reviewedAt: new Date("2026-05-29T01:00:00.000Z")
    });

    assert.equal(result.outputPath, undefined);
    assert.equal(result.reviewedEvidence, 2);
    assert.equal(result.reviewRecords, 3);
    assert.equal(result.skippedEvidence, 3);
    assert.equal(result.decision, "needs_followup");
    assert.deepEqual(result.records.map((record) => `${record.evidence_id}:${record.requirement_id}`), [
      "ev_scan_cloudflare_cloudflare_waf:ISMS-P-2.10.2.cloudflare-config-export",
      "ev_scan_cloudflare_cloudflare_workers:ISMS-P-2.10.2.cloudflare-config-export",
      "ev_scan_cloudflare_cloudflare_workers:ISMS-P-2.10.2.cloud-change-approval"
    ]);
    assert.match(result.records[0]?.rationale ?? "", /operating evidence is still required/);
    assert.deepEqual(result.skipped.map((item) => item.evidence_id).sort(), [
      "ev_manual_policy",
      "ev_scan_cloudflare_unmapped",
      "ev_scan_github_branch_protection"
    ]);
    const wafPreview = result.preview.find((item) => item.evidence_id === "ev_scan_cloudflare_cloudflare_waf");
    assert.equal(wafPreview?.title, "Cloudflare candidate: WAF rulesets observed.");
    assert.deepEqual(wafPreview?.requirement_ids, ["ISMS-P-2.10.2.cloudflare-config-export"]);
    assert.equal(wafPreview?.decision, "needs_followup");
    assert.equal(wafPreview?.eligible, true);

    const manualPreview = result.preview.find((item) => item.evidence_id === "ev_manual_policy");
    assert.equal(manualPreview?.eligible, false);
    assert.equal(manualPreview?.skip_reason, "not Cloudflare scanner evidence");
    assert.equal("title" in (manualPreview ?? {}), false);
    assert.equal("summary" in (manualPreview ?? {}), false);

    const unmappedPreview = result.preview.find((item) => item.evidence_id === "ev_scan_cloudflare_unmapped");
    assert.equal(unmappedPreview?.title, "Authentication policy candidate");
    assert.deepEqual(unmappedPreview?.requirement_ids, []);
    assert.equal(unmappedPreview?.eligible, false);
    assert.equal(unmappedPreview?.skip_reason, "no requirement mapping");

    await assert.rejects(readFile(join(dir, "reviews", "evidence-review.jsonl"), "utf8"), /ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reviewCloudflareEvidence appends needs_followup records that satisfy public validation review warnings", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-review-cloudflare-append-"));
  try {
    await mkdir(join(dir, "evidence"), { recursive: true });
    await writeFile(join(dir, "evidence", "index.jsonl"), cloudflareEvidenceRows().slice(0, 2).map((row) => JSON.stringify(row)).join("\n") + "\n");

    const before = await validateEvidence(dir, { public: true });
    assert.match(before.warnings.join("\n"), /has candidate requirement mapping but no review decision/);

    const result = await reviewCloudflareEvidence(dir, {
      reviewer: "security-owner",
      reviewedAt: new Date("2026-05-29T01:00:00.000Z")
    });

    assert.equal(result.outputPath, join(dir, "reviews", "evidence-review.jsonl"));
    assert.equal(result.reviewedEvidence, 2);
    assert.equal(result.reviewRecords, 3);

    const rows = (await readFile(result.outputPath ?? "", "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(rows.map((row) => row.decision), ["needs_followup", "needs_followup", "needs_followup"]);
    assert.deepEqual(rows.map((row) => row.reviewed_at), [
      "2026-05-29T01:00:00.000Z",
      "2026-05-29T01:00:00.000Z",
      "2026-05-29T01:00:00.000Z"
    ]);

    const after = await validateEvidence(dir, { public: true });
    assert.equal(after.valid, true);
    assert.doesNotMatch(after.warnings.join("\n"), /has candidate requirement mapping but no review decision/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reviewCloudflareEvidence skips unchanged latest non-accepted decisions on rerun", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-review-cloudflare-idempotent-"));
  try {
    await mkdir(join(dir, "evidence"), { recursive: true });
    await writeFile(join(dir, "evidence", "index.jsonl"), cloudflareEvidenceRows().slice(0, 2).map((row) => JSON.stringify(row)).join("\n") + "\n");

    const first = await reviewCloudflareEvidence(dir, {
      reviewer: "security-owner",
      reviewedAt: new Date("2026-05-29T01:00:00.000Z")
    });
    assert.equal(first.reviewRecords, 3);

    const second = await reviewCloudflareEvidence(dir, {
      reviewer: "security-owner",
      reviewedAt: new Date("2026-05-29T02:00:00.000Z")
    });

    assert.equal(second.outputPath, undefined);
    assert.equal(second.reviewedEvidence, 0);
    assert.equal(second.reviewRecords, 0);
    assert.equal(second.skippedEvidence, 3);
    assert.deepEqual(second.skipped.map((item) => item.reason), [
      "existing unchanged needs_followup review decision for ISMS-P-2.10.2.cloudflare-config-export",
      "existing unchanged needs_followup review decision for ISMS-P-2.10.2.cloudflare-config-export",
      "existing unchanged needs_followup review decision for ISMS-P-2.10.2.cloud-change-approval"
    ]);

    const rows = (await readFile(join(dir, "reviews", "evidence-review.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((row) => row.reviewed_at), [
      "2026-05-29T01:00:00.000Z",
      "2026-05-29T01:00:00.000Z",
      "2026-05-29T01:00:00.000Z"
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reviewCloudflareEvidence appends when latest non-accepted decision changes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-review-cloudflare-state-change-"));
  try {
    await mkdir(join(dir, "evidence"), { recursive: true });
    await writeFile(join(dir, "evidence", "index.jsonl"), cloudflareEvidenceRows().slice(0, 1).map((row) => JSON.stringify(row)).join("\n") + "\n");

    await reviewCloudflareEvidence(dir, {
      reviewer: "security-owner",
      reviewedAt: new Date("2026-05-29T01:00:00.000Z")
    });

    const changed = await reviewCloudflareEvidence(dir, {
      decision: "rejected",
      rationale: "This Cloudflare signal is not in the certification scope.",
      reviewer: "security-owner",
      reviewedAt: new Date("2026-05-29T02:00:00.000Z")
    });

    assert.equal(changed.reviewRecords, 1);
    assert.equal(changed.records[0]?.decision, "rejected");

    const rows = (await readFile(join(dir, "reviews", "evidence-review.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(rows.map((row) => row.decision), ["needs_followup", "rejected"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reviewCloudflareEvidence rejects accepted decisions and requires rationale for rejected decisions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-review-cloudflare-guardrail-"));
  try {
    await mkdir(join(dir, "evidence"), { recursive: true });
    await writeFile(join(dir, "evidence", "index.jsonl"), cloudflareEvidenceRows().slice(0, 1).map((row) => JSON.stringify(row)).join("\n") + "\n");

    await assert.rejects(reviewCloudflareEvidence(dir, {
      decision: "accepted",
      rationale: "Owner accepted it."
    }), /Cloudflare bulk review cannot auto-accept scanner evidence/);

    await assert.rejects(reviewCloudflareEvidence(dir, {
      decision: "rejected",
      rationale: "   "
    }), /Cloudflare rejected bulk review requires --rationale/);

    const result = await reviewCloudflareEvidence(dir, {
      decision: "rejected",
      rationale: "This Cloudflare signal is not in the certification scope.",
      reviewedAt: new Date("2026-05-29T02:00:00.000Z")
    });

    assert.equal(result.reviewRecords, 1);
    assert.equal(result.records[0]?.decision, "rejected");
    assert.equal(result.records[0]?.rationale, "This Cloudflare signal is not in the certification scope.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reviewCloudflareEvidence does not downgrade existing accepted manual reviews", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-review-cloudflare-preserve-accepted-"));
  try {
    await mkdir(join(dir, "evidence"), { recursive: true });
    await mkdir(join(dir, "reviews"), { recursive: true });
    await writeFile(join(dir, "evidence", "index.jsonl"), cloudflareEvidenceRows().slice(0, 1).map((row) => JSON.stringify(row)).join("\n") + "\n");
    const acceptedReview = {
      schemaVersion: 1,
      reviewed_at: "2026-05-29T00:00:00.000Z",
      evidence_id: "ev_scan_cloudflare_cloudflare_waf",
      requirement_id: "ISMS-P-2.10.2.cloudflare-config-export",
      decision: "accepted",
      reviewer: "security-owner",
      rationale: "Owner confirmed operating evidence."
    };
    await writeFile(join(dir, "reviews", "evidence-review.jsonl"), JSON.stringify(acceptedReview) + "\n");

    const result = await reviewCloudflareEvidence(dir, {
      reviewer: "security-owner",
      reviewedAt: new Date("2026-05-29T04:00:00.000Z")
    });

    assert.equal(result.reviewRecords, 0);
    assert.equal(result.outputPath, undefined);
    assert.deepEqual(result.skipped, [{
      evidence_id: "ev_scan_cloudflare_cloudflare_waf",
      reason: "existing accepted review decision for ISMS-P-2.10.2.cloudflare-config-export"
    }]);

    const rows = (await readFile(join(dir, "reviews", "evidence-review.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(rows, [acceptedReview]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reviewEvidence appends a human review record for an indexed evidence item", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-review-"));
  try {
    await mkdir(join(dir, "evidence"), { recursive: true });
    await mkdir(join(dir, "evidence", "private", "ISMS-P-2.5.3"), { recursive: true });
    await writeFile(join(dir, "evidence", "private", "ISMS-P-2.5.3", "mfa-review.md"), "# MFA review\n");
    await writeFile(join(dir, "evidence", "index.jsonl"), JSON.stringify(evidence({ evidence_id: "ev_auth_mfa" })) + "\n");

    const result = await reviewEvidence(dir, {
      evidenceId: "ev_auth_mfa",
      requirementId: "ISMS-P-2.5.3.admin-mfa",
      decision: "accepted",
      rationale: "Owner confirmed MFA enforcement.",
      reviewer: "security-owner",
      privateEvidencePath: "evidence/private/ISMS-P-2.5.3/mfa-review.md",
      reviewedAt: new Date("2026-05-28T02:00:00.000Z")
    });

    assert.equal(result.outputPath, join(dir, "reviews", "evidence-review.jsonl"));
    const rows = (await readFile(result.outputPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(rows, [{
      schemaVersion: 1,
      reviewed_at: "2026-05-28T02:00:00.000Z",
      evidence_id: "ev_auth_mfa",
      requirement_id: "ISMS-P-2.5.3.admin-mfa",
      decision: "accepted",
      reviewer: "security-owner",
      private_evidence_path: "evidence/private/ISMS-P-2.5.3/mfa-review.md",
      rationale: "Owner confirmed MFA enforcement."
    }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reviewEvidence requires existing private evidence for accepted decisions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-review-private-"));
  try {
    await mkdir(join(dir, "evidence"), { recursive: true });
    await mkdir(join(dir, "evidence", "private", "ISMS-P-2.5.3"), { recursive: true });
    await mkdir(join(dir, "project"), { recursive: true });
    await writeFile(join(dir, "evidence", "private", "ISMS-P-2.5.3", "mfa-review.md"), "# MFA review\n");
    await writeFile(join(dir, "project", "mfa-review.md"), "# not private evidence\n");
    await writeFile(join(dir, "evidence", "index.jsonl"), JSON.stringify(evidence({ evidence_id: "ev_auth_mfa" })) + "\n");

    const accepted = {
      evidenceId: "ev_auth_mfa",
      requirementId: "ISMS-P-2.5.3.admin-mfa",
      decision: "accepted" as const,
      rationale: "Owner confirmed MFA enforcement."
    };

    await assert.rejects(reviewEvidence(dir, accepted), /requires --private-evidence/);
    await assert.rejects(
      reviewEvidence(dir, { ...accepted, privateEvidencePath: "project/mfa-review.md" }),
      /must be under evidence\/private\//
    );
    await assert.rejects(
      reviewEvidence(dir, { ...accepted, privateEvidencePath: "evidence/private/ISMS-P-2.5.3/missing.md" }),
      /does not exist/
    );

    const result = await reviewEvidence(dir, {
      ...accepted,
      privateEvidencePath: "evidence/private/ISMS-P-2.5.3/mfa-review.md",
      reviewedAt: new Date("2026-05-28T02:00:00.000Z")
    });

    assert.equal(result.record.private_evidence_path, "evidence/private/ISMS-P-2.5.3/mfa-review.md");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reviewEvidence rejects unknown evidence ids", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-review-missing-"));
  try {
    await mkdir(join(dir, "evidence"), { recursive: true });
    await writeFile(join(dir, "evidence", "index.jsonl"), JSON.stringify(evidence({ evidence_id: "ev_known" })) + "\n");

    await assert.rejects(reviewEvidence(dir, {
      evidenceId: "ev_missing",
      requirementId: "ISMS-P-2.5.3.admin-mfa",
      decision: "accepted",
      rationale: "Owner confirmed MFA enforcement."
    }), /Evidence id not found in evidence\/index\.jsonl: ev_missing/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("validateEvidence warns when mapped candidate evidence has no review decision", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-review-warning-"));
  try {
    await mkdir(join(dir, "evidence"), { recursive: true });
    await writeFile(join(dir, "evidence", "index.jsonl"), JSON.stringify(evidence({
      evidence_id: "ev_candidate",
      supports: ["ISMS-P-2.5.3.admin-mfa"]
    })) + "\n");

    const result = await validateEvidence(dir, { public: true });

    assert.equal(result.valid, true);
    assert.match(result.warnings.join("\n"), /ev_candidate/);
    assert.match(result.warnings.join("\n"), /has candidate requirement mapping but no review decision/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("validateEvidence rejects accepted reviews without valid private evidence references", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-accepted-private-validation-"));
  try {
    await mkdir(join(dir, "evidence"), { recursive: true });
    await mkdir(join(dir, "reviews"), { recursive: true });
    await mkdir(join(dir, "project"), { recursive: true });
    await writeFile(join(dir, "evidence", "index.jsonl"), JSON.stringify(evidence({
      evidence_id: "ev_auth_mfa",
      supports: ["ISMS-P-2.5.3.admin-mfa"]
    })) + "\n");
    await writeFile(join(dir, "project", "review.md"), "# outside private evidence\n");
    await writeFile(join(dir, "reviews", "evidence-review.jsonl"), [
      JSON.stringify({
        schemaVersion: 1,
        reviewed_at: "2026-05-28T01:00:00.000Z",
        evidence_id: "ev_auth_mfa",
        requirement_id: "ISMS-P-2.5.3.admin-mfa",
        decision: "accepted",
        rationale: "Missing private evidence path."
      }),
      JSON.stringify({
        schemaVersion: 1,
        reviewed_at: "2026-05-28T02:00:00.000Z",
        evidence_id: "ev_auth_mfa",
        requirement_id: "ISMS-P-2.5.3.admin-mfa",
        decision: "accepted",
        rationale: "Outside private evidence path.",
        private_evidence_path: "project/review.md"
      }),
      JSON.stringify({
        schemaVersion: 1,
        reviewed_at: "2026-05-28T03:00:00.000Z",
        evidence_id: "ev_auth_mfa",
        requirement_id: "ISMS-P-2.5.3.admin-mfa",
        decision: "accepted",
        rationale: "Missing private file.",
        private_evidence_path: "evidence/private/ISMS-P-2.5.3/missing.md"
      })
    ].join("\n") + "\n");

    const result = await validateEvidence(dir, { public: true });

    assert.equal(result.valid, false);
    assert.match(result.issues.join("\n"), /accepted review ev_auth_mfa for ISMS-P-2\.5\.3\.admin-mfa requires private_evidence_path/);
    assert.match(result.issues.join("\n"), /must reference evidence\/private\//);
    assert.match(result.issues.join("\n"), /private_evidence_path does not exist/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("validateEvidence rejects accepted review private evidence symlinks that resolve outside workspace", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-accepted-private-symlink-"));
  const outsideDir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-accepted-private-outside-"));
  try {
    await mkdir(join(dir, "evidence", "private", "ISMS-P-2.5.3"), { recursive: true });
    await mkdir(join(dir, "reviews"), { recursive: true });
    await writeFile(join(outsideDir, "review.md"), "# outside private evidence\n");
    await symlink(
      join(outsideDir, "review.md"),
      join(dir, "evidence", "private", "ISMS-P-2.5.3", "review.md")
    );
    await writeFile(join(dir, "evidence", "index.jsonl"), JSON.stringify(evidence({
      evidence_id: "ev_auth_mfa",
      supports: ["ISMS-P-2.5.3.admin-mfa"]
    })) + "\n");
    await writeFile(join(dir, "reviews", "evidence-review.jsonl"), JSON.stringify({
      schemaVersion: 1,
      reviewed_at: "2026-05-28T01:00:00.000Z",
      evidence_id: "ev_auth_mfa",
      requirement_id: "ISMS-P-2.5.3.admin-mfa",
      decision: "accepted",
      rationale: "Symlinked private evidence.",
      private_evidence_path: "evidence/private/ISMS-P-2.5.3/review.md"
    }) + "\n");

    const result = await validateEvidence(dir, { public: true });

    assert.equal(result.valid, false);
    assert.match(result.issues.join("\n"), /accepted review ev_auth_mfa for ISMS-P-2\.5\.3\.admin-mfa/);
    assert.match(result.issues.join("\n"), /symlink resolves outside the workspace/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  }
});

test("validateEvidence accepts accepted reviews with private evidence reference and public-safe locator", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-accepted-private-valid-"));
  try {
    await mkdir(join(dir, "evidence", "private", "ISMS-P-2.10.2"), { recursive: true });
    await mkdir(join(dir, "reviews"), { recursive: true });
    await writeFile(join(dir, "evidence", "private", "ISMS-P-2.10.2", "security-review.md"), "# Private review\n");
    await writeFile(join(dir, "evidence", "index.jsonl"), JSON.stringify(evidence({
      evidence_id: "ev_cloudflare_security_review",
      supports: ["ISMS-P-2.10.2.cloudflare-config-export"],
      locator: {
        kind: "external_reference",
        value: "private-cloudflare-security-review"
      }
    })) + "\n");
    await writeFile(join(dir, "reviews", "evidence-review.jsonl"), JSON.stringify({
      schemaVersion: 1,
      reviewed_at: "2026-05-29T00:00:00.000Z",
      evidence_id: "ev_cloudflare_security_review",
      requirement_id: "ISMS-P-2.10.2.cloudflare-config-export",
      decision: "accepted",
      rationale: "Private review confirmed.",
      private_evidence_path: "evidence/private/ISMS-P-2.10.2/security-review.md"
    }) + "\n");

    const result = await validateEvidence(dir, { public: true });

    assert.equal(result.valid, true);
    assert.deepEqual(result.issues, []);
    assert.deepEqual(result.warnings, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("exportPublicEvidence writes a redacted index and omits unsafe evidence", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-export-public-"));
  try {
    await mkdir(join(dir, "evidence"), { recursive: true });
    await writeFile(join(dir, "evidence", "index.jsonl"), [
      JSON.stringify(evidence({ evidence_id: "ev_public", classification: "public_sample", locator: { kind: "workspace_path", value: "evidence/private/raw.json" } })),
      JSON.stringify(evidence({ evidence_id: "ev_secret", classification: "secret" }))
    ].join("\n") + "\n");

    const result = await exportPublicEvidence(dir);

    assert.equal(result.exportedEvidence, 1);
    const rows = (await readFile(result.outputPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(rows, [{
      evidence_id: "ev_public",
      title: "Authentication policy candidate",
      evidence_type: "policy_document",
      classification: "public_sample",
      lifecycle_status: "candidate",
      origin: "manual",
      supports: ["ISMS-P-2.5.3.auth-policy"],
      summary: "Auth policy exists as candidate evidence.",
      collected_at: "2026-05-28T00:00:00.000Z",
      review_required: true
    }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("exportPublicEvidence only exports public samples", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-export-public-only-"));
  try {
    await mkdir(join(dir, "evidence"), { recursive: true });
    await writeFile(join(dir, "evidence", "index.jsonl"), [
      JSON.stringify(evidence({ evidence_id: "ev_sample", classification: "public_sample" })),
      JSON.stringify(evidence({ evidence_id: "ev_internal", classification: "internal" })),
      JSON.stringify(evidence({ evidence_id: "ev_confidential", classification: "confidential" }))
    ].join("\n") + "\n");

    const result = await exportPublicEvidence(dir);

    assert.equal(result.exportedEvidence, 1);
    assert.equal(result.omittedEvidence, 2);
    const rows = (await readFile(result.outputPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(rows.map((row) => row.evidence_id), ["ev_sample"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("public evidence validation and exports do not expose Cloudflare review rationale", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-cloudflare-public-rationale-"));
  try {
    await mkdir(join(dir, "evidence"), { recursive: true });
    await writeFile(join(dir, "evidence", "index.jsonl"), cloudflareEvidenceRows().slice(0, 1).map((row) => JSON.stringify(row)).join("\n") + "\n");

    const privateRationale = "Private review detail for internal audit follow-up.";
    await reviewCloudflareEvidence(dir, {
      rationale: privateRationale,
      reviewer: "security-owner",
      reviewedAt: new Date("2026-05-29T03:00:00.000Z")
    });

    const validation = await validateEvidence(dir, { public: true });
    assert.equal(validation.valid, true);
    assert.doesNotMatch(JSON.stringify(validation), new RegExp(privateRationale));

    const exported = await exportPublicEvidence(dir);
    assert.equal(exported.exportedEvidence, 0);
    const content = await readFile(exported.outputPath, "utf8");
    assert.equal(content, "");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("indexEvidenceFromScan reports a friendly error when scans are missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-index-missing-scans-"));
  try {
    await assert.rejects(indexEvidenceFromScan(dir), /No scan JSON files found in scans\/\. Run ismsp scan before evidence index\./);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("validateEvidence rejects git-tracked private evidence paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-git-"));
  try {
    await mkdir(join(dir, "evidence", "private"), { recursive: true });
    await writeFile(join(dir, "evidence", "private", "cloudflare-export.json"), "{}\n");

    assert.equal(spawnSync("git", ["init"], { cwd: dir, encoding: "utf8" }).status, 0);
    assert.equal(spawnSync("git", ["add", "evidence/private/cloudflare-export.json"], { cwd: dir, encoding: "utf8" }).status, 0);

    const result = await validateEvidence(dir, { public: true });

    assert.equal(result.valid, false);
    assert.match(result.issues.join("\n"), /git-tracked private evidence path/);
    assert.match(result.issues.join("\n"), /evidence\/private\/cloudflare-export\.json/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("addManualEvidence registers existing private evidence without storing private path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-add-"));
  try {
    const privatePath = join(dir, "evidence", "private", "ISMS-P-2.5.3", "authentication-policy", "2026-Q2.md");
    await mkdir(join(privatePath, ".."), { recursive: true });
    await writeFile(privatePath, "# Authentication policy\n\nReviewed for 2026 Q2.\n");

    const result = await addManualEvidence(dir, {
      id: "ev_manual_auth_policy_2026_q2",
      title: "Authentication policy 2026 Q2",
      evidenceType: "policy_document",
      classification: "internal",
      supports: ["ISMS-P-2.5.3.authentication-policy"],
      privateEvidencePath: "evidence/private/ISMS-P-2.5.3/authentication-policy/2026-Q2.md",
      summary: "Authentication policy reviewed for 2026 Q2.",
      collectedAt: new Date("2026-05-29T00:00:00.000Z")
    });

    assert.equal(result.outputPath, join(dir, "evidence", "index.jsonl"));
    assert.equal(result.item.evidence_id, "ev_manual_auth_policy_2026_q2");
    assert.equal(result.item.origin, "manual");
    assert.equal(result.item.lifecycle_status, "needs_review");
    assert.equal(result.item.review_required, true);
    assert.deepEqual(result.item.supports, ["ISMS-P-2.5.3.authentication-policy"]);
    assert.deepEqual(result.item.locator, {
      kind: "external_reference",
      value: "ev_manual_auth_policy_2026_q2"
    });
    assert.equal(result.item.metadata.private_evidence_present, true);
    assert.equal(typeof result.item.content_sha256, "string");
    assert.equal(result.item.content_sha256?.length, 64);

    const content = await readFile(join(dir, "evidence", "index.jsonl"), "utf8");
    assert.match(content, /ev_manual_auth_policy_2026_q2/);
    assert.doesNotMatch(content, /evidence\/private/);
    assert.doesNotMatch(content, /2026-Q2\.md/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("manual evidence validates with warning until accepted review references private evidence", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-add-review-flow-"));
  try {
    const privateEvidencePath = "evidence/private/ISMS-P-2.5.3/authentication-policy/2026-Q2.md";
    const privatePath = join(dir, privateEvidencePath);
    await mkdir(join(privatePath, ".."), { recursive: true });
    await writeFile(privatePath, "# Authentication policy\n\nReviewed for 2026 Q2.\n");

    const added = await addManualEvidence(dir, {
      id: "ev_manual_auth_policy_2026_q2",
      title: "Authentication policy 2026 Q2",
      evidenceType: "policy_document",
      classification: "internal",
      supports: ["ISMS-P-2.5.3.authentication-policy"],
      privateEvidencePath,
      summary: "Authentication policy reviewed for 2026 Q2.",
      collectedAt: new Date("2026-05-29T00:00:00.000Z")
    });

    assert.equal(added.item.lifecycle_status, "needs_review");
    assert.equal(added.item.review_required, true);
    const beforeReview = await validateEvidence(dir, { public: true });
    assert.equal(beforeReview.valid, true);
    assert.deepEqual(beforeReview.issues, []);
    assert.match(beforeReview.warnings.join("\n"), /ev_manual_auth_policy_2026_q2/);
    assert.match(beforeReview.warnings.join("\n"), /has candidate requirement mapping but no review decision/);

    const reviewed = await reviewEvidence(dir, {
      evidenceId: "ev_manual_auth_policy_2026_q2",
      requirementId: "ISMS-P-2.5.3.authentication-policy",
      decision: "accepted",
      rationale: "Security owner confirmed the private authentication policy review.",
      reviewer: "security-owner",
      privateEvidencePath,
      reviewedAt: new Date("2026-05-29T01:00:00.000Z")
    });

    assert.equal(reviewed.record.private_evidence_path, privateEvidencePath);
    const afterReview = await validateEvidence(dir, { public: true });
    assert.equal(afterReview.valid, true);
    assert.deepEqual(afterReview.issues, []);
    assert.deepEqual(afterReview.warnings, []);
    const indexContent = await readFile(join(dir, "evidence", "index.jsonl"), "utf8");
    const rows = indexContent.trim().split("\n").map((line) => JSON.parse(line) as EvidenceItem);
    const preserved = rows.find((row) => row.evidence_id === "ev_manual_auth_policy_2026_q2");
    assert.equal(preserved?.lifecycle_status, "needs_review");
    assert.equal(preserved?.review_required, true);
    assert.doesNotMatch(indexContent, /evidence\/private/);
    assert.doesNotMatch(indexContent, /2026-Q2\.md/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("addManualEvidence rejects duplicate evidence ids", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-add-duplicate-"));
  try {
    const privatePath = join(dir, "evidence", "private", "ISMS-P-2.5.3", "review.md");
    await mkdir(join(privatePath, ".."), { recursive: true });
    await writeFile(privatePath, "review");
    await mkdir(join(dir, "evidence"), { recursive: true });
    await writeFile(join(dir, "evidence", "index.jsonl"), JSON.stringify(evidence({
      evidence_id: "ev_manual_auth_policy_2026_q2",
      origin: "manual"
    })) + "\n");

    await assert.rejects(addManualEvidence(dir, {
      id: "ev_manual_auth_policy_2026_q2",
      title: "Authentication policy 2026 Q2",
      evidenceType: "policy_document",
      classification: "internal",
      supports: ["ISMS-P-2.5.3.authentication-policy"],
      privateEvidencePath: "evidence/private/ISMS-P-2.5.3/review.md",
      summary: "Authentication policy reviewed for 2026 Q2."
    }), /Evidence id already exists in evidence\/index\.jsonl: ev_manual_auth_policy_2026_q2/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("addManualEvidence requires an existing private evidence path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-add-path-"));
  try {
    await assert.rejects(addManualEvidence(dir, {
      id: "ev_manual_auth_policy_2026_q2",
      title: "Authentication policy 2026 Q2",
      evidenceType: "policy_document",
      classification: "internal",
      supports: ["ISMS-P-2.5.3.authentication-policy"],
      privateEvidencePath: "evidence/private/ISMS-P-2.5.3/missing.md",
      summary: "Authentication policy reviewed for 2026 Q2."
    }), /Manual evidence private path does not exist/);

    const publicPath = join(dir, "project", "review.md");
    await mkdir(join(publicPath, ".."), { recursive: true });
    await writeFile(publicPath, "review");
    await assert.rejects(addManualEvidence(dir, {
      id: "ev_manual_auth_policy_2026_q3",
      title: "Authentication policy 2026 Q3",
      evidenceType: "policy_document",
      classification: "internal",
      supports: ["ISMS-P-2.5.3.authentication-policy"],
      privateEvidencePath: "project/review.md",
      summary: "Authentication policy reviewed for 2026 Q3."
    }), /Manual evidence private path must be under evidence\/private\//);

    await assert.rejects(addManualEvidence(dir, {
      id: "ev_manual_auth_policy_2026_q4",
      title: "Authentication policy 2026 Q4",
      evidenceType: "policy_document",
      classification: "internal",
      supports: ["ISMS-P-2.5.3.authentication-policy"],
      privateEvidencePath: "../outside.md",
      summary: "Authentication policy reviewed for 2026 Q4."
    }), /Manual evidence private path must be inside the workspace/);

    const privatePath = join(dir, "evidence", "private", "ISMS-P-2.5.3", "review.md");
    await mkdir(join(privatePath, ".."), { recursive: true });
    await writeFile(privatePath, "review");
    await assert.rejects(addManualEvidence(dir, {
      id: "ev_manual_auth_policy_2026_q5",
      title: "Authentication policy 2026 Q5",
      evidenceType: "policy_document",
      classification: "internal",
      supports: ["ISMS-P-2.5.3.authentication-policy"],
      privateEvidencePath: privatePath,
      summary: "Authentication policy reviewed for 2026 Q5."
    }), /Manual evidence private path must be workspace-relative/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("addManualEvidence rejects private evidence symlinks that resolve outside workspace", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-add-symlink-"));
  const outsideDir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-add-outside-"));
  try {
    await mkdir(join(dir, "evidence", "private", "ISMS-P-2.5.3"), { recursive: true });
    await writeFile(join(outsideDir, "outside.md"), "outside file evidence");
    await symlink(
      join(outsideDir, "outside.md"),
      join(dir, "evidence", "private", "ISMS-P-2.5.3", "outside-file.md")
    );

    await assert.rejects(addManualEvidence(dir, {
      id: "ev_manual_symlink_file",
      title: "Symlink file",
      evidenceType: "policy_document",
      classification: "internal",
      supports: ["ISMS-P-2.5.3.authentication-policy"],
      privateEvidencePath: "evidence/private/ISMS-P-2.5.3/outside-file.md",
      summary: "Symlink file evidence."
    }), /Manual evidence private path symlink resolves outside the workspace/);

    await mkdir(join(outsideDir, "outside-dir"), { recursive: true });
    await writeFile(join(outsideDir, "outside-dir", "review.md"), "outside directory evidence");
    await symlink(
      join(outsideDir, "outside-dir"),
      join(dir, "evidence", "private", "ISMS-P-2.5.3", "outside-dir"),
      "dir"
    );

    await assert.rejects(addManualEvidence(dir, {
      id: "ev_manual_symlink_dir",
      title: "Symlink directory",
      evidenceType: "policy_document",
      classification: "internal",
      supports: ["ISMS-P-2.5.3.authentication-policy"],
      privateEvidencePath: "evidence/private/ISMS-P-2.5.3/outside-dir",
      summary: "Symlink directory evidence."
    }), /Manual evidence private path symlink resolves outside the workspace/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  }
});

test("addManualEvidence rejects unsafe classifications and metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-add-safety-"));
  try {
    const privatePath = join(dir, "evidence", "private", "ISMS-P-2.5.3", "review.md");
    await mkdir(join(privatePath, ".."), { recursive: true });
    await writeFile(privatePath, "review");

    await assert.rejects(addManualEvidence(dir, {
      id: "ev_manual_secret",
      title: "Secret evidence",
      evidenceType: "policy_document",
      classification: "secret",
      supports: ["ISMS-P-2.5.3.authentication-policy"],
      privateEvidencePath: "evidence/private/ISMS-P-2.5.3/review.md",
      summary: "Secret evidence."
    }), /Manual evidence classification secret is not supported/);

    await assert.rejects(addManualEvidence(dir, {
      id: "ev_manual_token_metadata",
      title: "Token metadata",
      evidenceType: "policy_document",
      classification: "internal",
      supports: ["ISMS-P-2.5.3.authentication-policy"],
      privateEvidencePath: "evidence/private/ISMS-P-2.5.3/review.md",
      summary: "Metadata includes unsafe key.",
      metadata: { token: "redacted-token-placeholder" }
    }), /Manual evidence metadata contains credential-like metadata at token/);

    await assert.rejects(addManualEvidence(dir, {
      id: "ev_manual_private_path_metadata_key",
      title: "Private path metadata key",
      evidenceType: "policy_document",
      classification: "internal",
      supports: ["ISMS-P-2.5.3.authentication-policy"],
      privateEvidencePath: "evidence/private/ISMS-P-2.5.3/review.md",
      summary: "Metadata includes unsafe private path key.",
      metadata: { private_evidence_path: "redacted" }
    }), /Manual evidence metadata contains reserved private metadata at private_evidence_path/);

    await assert.rejects(addManualEvidence(dir, {
      id: "ev_manual_private_marker_metadata_key",
      title: "Private marker metadata key",
      evidenceType: "policy_document",
      classification: "internal",
      supports: ["ISMS-P-2.5.3.authentication-policy"],
      privateEvidencePath: "evidence/private/ISMS-P-2.5.3/review.md",
      summary: "Metadata attempts to override the generated marker.",
      metadata: { private_evidence_present: "false" }
    }), /Manual evidence metadata contains reserved private metadata at private_evidence_present/);

    await assert.rejects(addManualEvidence(dir, {
      id: "ev_manual_private_path_metadata_camel_key",
      title: "Private path metadata camel key",
      evidenceType: "policy_document",
      classification: "internal",
      supports: ["ISMS-P-2.5.3.authentication-policy"],
      privateEvidencePath: "evidence/private/ISMS-P-2.5.3/review.md",
      summary: "Metadata includes unsafe private path camel key.",
      metadata: { privateEvidencePath: "redacted" }
    }), /Manual evidence metadata contains reserved private metadata at privateEvidencePath/);

    await assert.rejects(addManualEvidence(dir, {
      id: "ev_manual_private_path_metadata_value",
      title: "Private path metadata value",
      evidenceType: "policy_document",
      classification: "internal",
      supports: ["ISMS-P-2.5.3.authentication-policy"],
      privateEvidencePath: "evidence/private/ISMS-P-2.5.3/review.md",
      summary: "Metadata includes unsafe private path value.",
      metadata: { source: "evidence/private/ISMS-P-2.5.3/review.md" }
    }), /Manual evidence metadata contains private path metadata at source/);

    await assert.rejects(addManualEvidence(dir, {
      id: "ev_manual_embedded_private_path_metadata_value",
      title: "Embedded private path metadata value",
      evidenceType: "policy_document",
      classification: "internal",
      supports: ["ISMS-P-2.5.3.authentication-policy"],
      privateEvidencePath: "evidence/private/ISMS-P-2.5.3/review.md",
      summary: "Metadata includes embedded unsafe private path value.",
      metadata: { note: "see evidence/private/ISMS-P-2.5.3/review.md" }
    }), /Manual evidence metadata contains private path metadata at note/);

    await assert.rejects(addManualEvidence(dir, {
      id: "ev_manual_relative_private_path_metadata_value",
      title: "Relative private path metadata value",
      evidenceType: "policy_document",
      classification: "internal",
      supports: ["ISMS-P-2.5.3.authentication-policy"],
      privateEvidencePath: "evidence/private/ISMS-P-2.5.3/review.md",
      summary: "Metadata includes relative unsafe private path value.",
      metadata: { note: "  ./evidence/private/ISMS-P-2.5.3/review.md" }
    }), /Manual evidence metadata contains private path metadata at note/);

    await assert.rejects(addManualEvidence(dir, {
      id: "ev_manual_absolute_path_metadata_value",
      title: "Absolute path metadata value",
      evidenceType: "policy_document",
      classification: "internal",
      supports: ["ISMS-P-2.5.3.authentication-policy"],
      privateEvidencePath: "evidence/private/ISMS-P-2.5.3/review.md",
      summary: "Metadata includes unsafe absolute path value.",
      metadata: { source: ["", "Users", "example", "private", "review.md"].join("/") }
    }), /Manual evidence metadata contains local path metadata at source/);

    await assert.rejects(addManualEvidence(dir, {
      id: "ev_manual_private_absolute_path_metadata_value",
      title: "Private absolute path metadata value",
      evidenceType: "policy_document",
      classification: "internal",
      supports: ["ISMS-P-2.5.3.authentication-policy"],
      privateEvidencePath: "evidence/private/ISMS-P-2.5.3/review.md",
      summary: "Metadata includes unsafe private absolute path value.",
      metadata: { source: "/private/tmp/review.md" }
    }), /Manual evidence metadata contains local path metadata at source/);

    await assert.rejects(addManualEvidence(dir, {
      id: "ev_manual_windows_path_metadata_value",
      title: "Windows path metadata value",
      evidenceType: "policy_document",
      classification: "internal",
      supports: ["ISMS-P-2.5.3.authentication-policy"],
      privateEvidencePath: "evidence/private/ISMS-P-2.5.3/review.md",
      summary: "Metadata includes unsafe Windows path value.",
      metadata: { source: "C:\\Users\\example\\review.md" }
    }), /Manual evidence metadata contains local path metadata at source/);

    const result = await addManualEvidence(dir, {
      id: "ev_manual_safe_metadata",
      title: "Safe metadata",
      evidenceType: "policy_document",
      classification: "internal",
      supports: ["ISMS-P-2.5.3.authentication-policy"],
      privateEvidencePath: "evidence/private/ISMS-P-2.5.3/review.md",
      summary: "Metadata includes safe scalar values.",
      metadata: { owner: "security" }
    });
    assert.equal(result.item.metadata.owner, "security");
    assert.equal(result.item.metadata.private_evidence_present, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("addManualEvidence computes stable content hashes for files and directories", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-add-hash-"));
  try {
    await mkdir(join(dir, "evidence", "private", "hashes"), { recursive: true });
    const filePath = join(dir, "evidence", "private", "hashes", "file.md");
    const fileBytes = "# Evidence file\n\nReviewed.\n";
    await writeFile(filePath, fileBytes);

    const fileResult = await addManualEvidence(dir, {
      id: "ev_manual_hash_file",
      title: "Hash file",
      evidenceType: "policy_document",
      classification: "internal",
      supports: ["ISMS-P-2.5.3.authentication-policy"],
      privateEvidencePath: "evidence/private/hashes/file.md",
      summary: "File hash evidence."
    });

    assert.equal(fileResult.item.content_sha256, createHash("sha256").update(fileBytes).digest("hex"));

    const stableA = join(dir, "evidence", "private", "hashes", "stable-a");
    await mkdir(stableA, { recursive: true });
    await writeFile(join(stableA, "b.txt"), "beta");
    await writeFile(join(stableA, "a.txt"), "alpha");
    await writeFile(join(stableA, ".DS_Store"), "ignored");
    const stableAResult = await addManualEvidence(dir, {
      id: "ev_manual_hash_stable_a",
      title: "Stable directory A",
      evidenceType: "policy_document",
      classification: "internal",
      supports: ["ISMS-P-2.5.3.authentication-policy"],
      privateEvidencePath: "evidence/private/hashes/stable-a",
      summary: "Directory hash evidence A."
    });

    const stableB = join(dir, "evidence", "private", "hashes", "stable-b");
    await mkdir(stableB, { recursive: true });
    await writeFile(join(stableB, "a.txt"), "alpha");
    await writeFile(join(stableB, ".DS_Store"), "different ignored content");
    await writeFile(join(stableB, "b.txt"), "beta");
    const stableBResult = await addManualEvidence(dir, {
      id: "ev_manual_hash_stable_b",
      title: "Stable directory B",
      evidenceType: "policy_document",
      classification: "internal",
      supports: ["ISMS-P-2.5.3.authentication-policy"],
      privateEvidencePath: "evidence/private/hashes/stable-b",
      summary: "Directory hash evidence B."
    });

    assert.equal(stableAResult.item.content_sha256, stableBResult.item.content_sha256);

    const contentChanged = join(dir, "evidence", "private", "hashes", "content-changed");
    await mkdir(contentChanged, { recursive: true });
    await writeFile(join(contentChanged, "a.txt"), "alpha changed");
    await writeFile(join(contentChanged, "b.txt"), "beta");
    const contentChangedResult = await addManualEvidence(dir, {
      id: "ev_manual_hash_content_changed",
      title: "Content changed directory",
      evidenceType: "policy_document",
      classification: "internal",
      supports: ["ISMS-P-2.5.3.authentication-policy"],
      privateEvidencePath: "evidence/private/hashes/content-changed",
      summary: "Directory hash content change evidence."
    });

    assert.notEqual(contentChangedResult.item.content_sha256, stableAResult.item.content_sha256);

    const pathChanged = join(dir, "evidence", "private", "hashes", "path-changed");
    await mkdir(join(pathChanged, "nested"), { recursive: true });
    await writeFile(join(pathChanged, "nested", "a.txt"), "alpha");
    await writeFile(join(pathChanged, "b.txt"), "beta");
    const pathChangedResult = await addManualEvidence(dir, {
      id: "ev_manual_hash_path_changed",
      title: "Path changed directory",
      evidenceType: "policy_document",
      classification: "internal",
      supports: ["ISMS-P-2.5.3.authentication-policy"],
      privateEvidencePath: "evidence/private/hashes/path-changed",
      summary: "Directory hash path change evidence."
    });

    assert.notEqual(pathChangedResult.item.content_sha256, stableAResult.item.content_sha256);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI supports evidence validate --public", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-cli-"));
  try {
    await mkdir(join(dir, "evidence"), { recursive: true });
    await writeFile(join(dir, "evidence", "index.jsonl"), JSON.stringify(evidence()) + "\n");

    const result = spawnSync(process.execPath, [join(process.cwd(), "dist", "cli.js"), "evidence", "validate", "--public"], {
      cwd: dir,
      encoding: "utf8"
    });

    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.valid, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI supports evidence add without storing private evidence paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-cli-add-"));
  try {
    const privatePath = join(dir, "evidence", "private", "ISMS-P-2.5.3", "authentication-policy", "2026-Q2.md");
    await mkdir(join(privatePath, ".."), { recursive: true });
    await writeFile(privatePath, "# Authentication policy\n\nReviewed for 2026 Q2.\n");

    const result = spawnSync(process.execPath, [
      join(process.cwd(), "dist", "cli.js"),
      "evidence",
      "add",
      "--id",
      "ev_manual_auth_policy_cli_2026_q2",
      "--title",
      "Authentication policy 2026 Q2",
      "--type",
      "policy_document",
      "--classification",
      "internal",
      "--supports",
      "ISMS-P-2.5.3.authentication-policy,ISMS-P-2.5.3.admin-mfa",
      "--supports",
      "ISMS-P-2.5.3.password-policy",
      "--private-evidence",
      "evidence/private/ISMS-P-2.5.3/authentication-policy/2026-Q2.md",
      "--summary",
      "Authentication policy reviewed for 2026 Q2.",
      "--metadata",
      "owner=security"
    ], {
      cwd: dir,
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.item.evidence_id, "ev_manual_auth_policy_cli_2026_q2");
    assert.equal(parsed.item.metadata.owner, "security");
    assert.equal(parsed.item.metadata.private_evidence_present, true);
    assert.deepEqual(parsed.item.supports, [
      "ISMS-P-2.5.3.admin-mfa",
      "ISMS-P-2.5.3.authentication-policy",
      "ISMS-P-2.5.3.password-policy"
    ]);

    const indexContent = await readFile(join(dir, "evidence", "index.jsonl"), "utf8");
    assert.match(indexContent, /ev_manual_auth_policy_cli_2026_q2/);
    assert.doesNotMatch(indexContent, /evidence\/private/);
    assert.doesNotMatch(indexContent, /2026-Q2\.md/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI rejects duplicate scalar evidence add flags without creating an index", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-cli-add-duplicate-"));
  try {
    const privatePath = join(dir, "evidence", "private", "ISMS-P-2.5.3", "authentication-policy", "2026-Q2.md");
    await mkdir(join(privatePath, ".."), { recursive: true });
    await writeFile(privatePath, "# Authentication policy\n\nReviewed for 2026 Q2.\n");

    const result = spawnSync(process.execPath, [
      join(process.cwd(), "dist", "cli.js"),
      "evidence",
      "add",
      "--id",
      "ev_manual_auth_policy_cli_2026_q2",
      "--id",
      "ev_manual_auth_policy_cli_2026_q2_duplicate",
      "--title",
      "Authentication policy 2026 Q2",
      "--type",
      "policy_document",
      "--classification",
      "internal",
      "--supports",
      "ISMS-P-2.5.3.authentication-policy",
      "--private-evidence",
      "evidence/private/ISMS-P-2.5.3/authentication-policy/2026-Q2.md",
      "--summary",
      "Authentication policy reviewed for 2026 Q2."
    ], {
      cwd: dir,
      encoding: "utf8"
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Usage: ismsp evidence add/);
    await assert.rejects(readFile(join(dir, "evidence", "index.jsonl"), "utf8"), /ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI supports evidence index, review, and export-public", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-cli-flow-"));
  try {
    await mkdir(join(dir, "scans"), { recursive: true });
    const scanPath = join(dir, "scans", "scan-2026-05-28T00-00-00-000Z.json");
    await writeFile(scanPath, stringifyJson(scanResult()));

    const indexResult = spawnSync(process.execPath, [join(process.cwd(), "dist", "cli.js"), "evidence", "index", "--from-scan", "scans/scan-2026-05-28T00-00-00-000Z.json"], {
      cwd: dir,
      encoding: "utf8"
    });
    assert.equal(indexResult.status, 0, indexResult.stderr);
    const indexed = JSON.parse(indexResult.stdout);
    assert.equal(indexed.indexedEvidence, 2);
    await mkdir(join(dir, "evidence", "private", "ISMS-P-2.10.2"), { recursive: true });
    await writeFile(join(dir, "evidence", "private", "ISMS-P-2.10.2", "waf-review.md"), "# WAF review\n");

    const reviewResult = spawnSync(process.execPath, [
      join(process.cwd(), "dist", "cli.js"),
      "evidence",
      "review",
      "ev_scan_cloudflare_cloudflare_waf",
      "--requirement",
      "ISMS-P-2.10.2.cloudflare-config-export",
      "--decision",
      "needs_followup",
      "--rationale",
      "API confirmation still required.",
      "--reviewer",
      "security-owner"
    ], {
      cwd: dir,
      encoding: "utf8"
    });
    assert.equal(reviewResult.status, 0, reviewResult.stderr);
    const reviewed = JSON.parse(reviewResult.stdout);
    assert.equal(reviewed.record.decision, "needs_followup");
    assert.equal(reviewed.record.private_evidence_path, undefined);

    const acceptedReview = spawnSync(process.execPath, [
      join(process.cwd(), "dist", "cli.js"),
      "evidence",
      "review",
      "ev_scan_cloudflare_cloudflare_waf",
      "--requirement",
      "ISMS-P-2.10.2.cloudflare-config-export",
      "--decision",
      "accepted",
      "--rationale",
      "Private WAF review confirmed.",
      "--reviewer",
      "security-owner",
      "--private-evidence",
      "evidence/private/ISMS-P-2.10.2/waf-review.md"
    ], {
      cwd: dir,
      encoding: "utf8"
    });
    assert.equal(acceptedReview.status, 0, acceptedReview.stderr);
    const accepted = JSON.parse(acceptedReview.stdout);
    assert.equal(accepted.record.private_evidence_path, "evidence/private/ISMS-P-2.10.2/waf-review.md");

    const exportResult = spawnSync(process.execPath, [join(process.cwd(), "dist", "cli.js"), "evidence", "export-public"], {
      cwd: dir,
      encoding: "utf8"
    });
    assert.equal(exportResult.status, 0, exportResult.stderr);
    const exported = JSON.parse(exportResult.stdout);
    assert.equal(exported.exportedEvidence, 0);
    assert.equal(exported.omittedEvidence, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI supports evidence review-cloudflare dry run and append flow", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-cli-review-cloudflare-"));
  try {
    await mkdir(join(dir, "evidence"), { recursive: true });
    await writeFile(join(dir, "evidence", "index.jsonl"), cloudflareEvidenceRows().slice(0, 2).map((row) => JSON.stringify(row)).join("\n") + "\n");

    const dryRun = spawnSync(process.execPath, [
      join(process.cwd(), "dist", "cli.js"),
      "evidence",
      "review-cloudflare",
      "--dry-run",
      "--reviewer",
      "security-owner"
    ], {
      cwd: dir,
      encoding: "utf8"
    });
    assert.equal(dryRun.status, 0, dryRun.stderr);
    const dryRunParsed = JSON.parse(dryRun.stdout);
    assert.equal(dryRunParsed.reviewRecords, 3);
    assert.equal(dryRunParsed.outputPath, undefined);
    assert.equal(dryRunParsed.preview[0].title, "Cloudflare candidate: WAF rulesets observed.");
    assert.equal(dryRunParsed.preview[0].eligible, true);

    const append = spawnSync(process.execPath, [
      join(process.cwd(), "dist", "cli.js"),
      "evidence",
      "review-cloudflare",
      "--decision",
      "needs_followup",
      "--reviewer",
      "security-owner"
    ], {
      cwd: dir,
      encoding: "utf8"
    });
    assert.equal(append.status, 0, append.stderr);
    const appended = JSON.parse(append.stdout);
    assert.equal(appended.reviewRecords, 3);
    assert.equal(String(appended.outputPath).endsWith("/reviews/evidence-review.jsonl"), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI rejects evidence review-cloudflare accepted decision", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-evidence-cli-review-cloudflare-accepted-"));
  try {
    const result = spawnSync(process.execPath, [
      join(process.cwd(), "dist", "cli.js"),
      "evidence",
      "review-cloudflare",
      "--decision",
      "accepted"
    ], {
      cwd: dir,
      encoding: "utf8"
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Cloudflare bulk review cannot auto-accept scanner evidence/);
    assert.doesNotMatch(result.stderr, /Error:/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function evidence(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    evidence_id: "ev_auth_policy",
    title: "Authentication policy candidate",
    evidence_type: "policy_document",
    classification: "internal",
    lifecycle_status: "candidate",
    origin: "manual",
    supports: ["ISMS-P-2.5.3.auth-policy"],
    locator: {
      kind: "workspace_path",
      value: "project/evaluation/specs/Auth_Spec.md"
    },
    summary: "Auth policy exists as candidate evidence.",
    collected_at: "2026-05-28T00:00:00.000Z",
    review_required: true,
    metadata: {},
    ...overrides
  };
}

function scanResult(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    schemaVersion: 1,
    generatedAt: "2026-05-28T00:00:00.000Z",
    signals: [
      {
        id: "auth-mfa",
        source: "local-docs",
        basis: "document-backed",
        summary: "MFA configuration is documented for admin authentication",
        paths: ["project/private/auth.md"],
        metadata: {
          requirement_ids: ["ISMS-P-2.5.3.admin-mfa"]
        }
      },
      {
        id: "cloudflare-waf",
        source: "cloudflare",
        basis: "needs_confirmation",
        summary: "Cloudflare WAF configuration requires API confirmation",
        paths: [],
        metadata: {
          zone: "example.com"
        }
      }
    ],
    ...overrides
  };
}

function cloudflareEvidenceRows(): EvidenceItem[] {
  return [
    evidence({
      evidence_id: "ev_scan_cloudflare_cloudflare_waf",
      title: "Cloudflare candidate: WAF rulesets observed.",
      evidence_type: "connector_snapshot",
      classification: "confidential",
      lifecycle_status: "candidate",
      origin: "scan",
      supports: ["ISMS-P-2.10.2.cloudflare-config-export"],
      locator: { kind: "scan_signal", value: "cloudflare:waf" },
      summary: "Cloudflare WAF rulesets were observed.",
      metadata: { signal_source: "cloudflare", product: "waf" }
    }),
    evidence({
      evidence_id: "ev_scan_cloudflare_cloudflare_workers",
      title: "Cloudflare candidate: Workers observed.",
      evidence_type: "connector_snapshot",
      classification: "confidential",
      lifecycle_status: "candidate",
      origin: "scan",
      supports: ["ISMS-P-2.10.2.cloudflare-config-export", "ISMS-P-2.10.2.cloud-change-approval"],
      locator: { kind: "scan_signal", value: "cloudflare:workers" },
      summary: "Cloudflare Workers metadata was observed.",
      metadata: { signal_source: "cloudflare", product: "workers" }
    }),
    evidence({
      evidence_id: "ev_manual_policy",
      origin: "manual",
      supports: ["ISMS-P-2.10.2.cloud-policy"],
      metadata: {}
    }),
    evidence({
      evidence_id: "ev_scan_github_branch_protection",
      evidence_type: "connector_snapshot",
      classification: "confidential",
      lifecycle_status: "candidate",
      origin: "scan",
      supports: ["ISMS-P-2.5.6.access-review"],
      locator: { kind: "scan_signal", value: "github:branch-protection" },
      metadata: { signal_source: "github" }
    }),
    evidence({
      evidence_id: "ev_scan_cloudflare_unmapped",
      evidence_type: "connector_snapshot",
      classification: "confidential",
      lifecycle_status: "candidate",
      origin: "scan",
      supports: [],
      locator: { kind: "scan_signal", value: "cloudflare:unmapped" },
      metadata: { signal_source: "cloudflare", product: "future-product" }
    })
  ];
}
