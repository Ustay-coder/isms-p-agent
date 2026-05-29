import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { exportPublicEvidence, indexEvidenceFromScan, reviewCloudflareEvidence, reviewEvidence, validateEvidence } from "../../src/commands/evidence.js";
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
    await writeFile(join(dir, "evidence", "index.jsonl"), JSON.stringify(evidence({ evidence_id: "ev_auth_mfa" })) + "\n");

    const result = await reviewEvidence(dir, {
      evidenceId: "ev_auth_mfa",
      requirementId: "ISMS-P-2.5.3.admin-mfa",
      decision: "accepted",
      rationale: "Owner confirmed MFA enforcement.",
      reviewer: "security-owner",
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
      rationale: "Owner confirmed MFA enforcement."
    }]);
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
    await assert.rejects(indexEvidenceFromScan(dir), /No scan JSON files found in scans\/\. Run isms-agent scan before evidence index\./);
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
