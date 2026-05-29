import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateEvidence } from "../../src/commands/evidence.js";
import { stringifyJson } from "../../src/core/json.js";
import type { EvidenceItem } from "../../src/schemas/evidence.js";

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
