import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { exportPublicEvidence, indexEvidenceFromScan, reviewEvidence, validateEvidence } from "../../src/commands/evidence.js";
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
