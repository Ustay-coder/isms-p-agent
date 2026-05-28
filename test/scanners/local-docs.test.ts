import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { initWorkspace } from "../../src/commands/init.js";
import { scanLocal } from "../../src/commands/scan.js";
import { scanLocalDocs } from "../../src/scanners/local-docs.js";

const SECRET_VALUE = "doc-secret-value-987";

test("scanLocalDocs indexes document filenames and markdown headings without bodies", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-local-docs-"));
  try {
    await mkdir(join(dir, "project", "security"), { recursive: true });
    await mkdir(join(dir, "reports"), { recursive: true });

    await writeFile(
      join(dir, "project", "security", "access-policy.md"),
      [
        "# Access Policy",
        "",
        "This paragraph contains implementation details and " + SECRET_VALUE,
        "",
        "## Quarterly Review"
      ].join("\n")
    );
    await writeFile(join(dir, "project", "security", "notes.txt"), "plain document body");
    await writeFile(join(dir, "reports", "generated.md"), "# Should Be Skipped\n");

    const signals = await scanLocalDocs(dir);
    const serialized = JSON.stringify(signals);

    assert.match(serialized, /project\/security\/access-policy\.md/);
    assert.match(serialized, /Access Policy/);
    assert.match(serialized, /Quarterly Review/);
    assert.match(serialized, /project\/security\/notes\.txt/);
    assert.doesNotMatch(serialized, /implementation details/);
    assert.doesNotMatch(serialized, new RegExp(SECRET_VALUE));
    assert.doesNotMatch(serialized, /reports\/generated/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("scanLocalDocs redacts sensitive values from markdown headings", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-local-docs-redact-"));
  try {
    await mkdir(join(dir, "project"), { recursive: true });
    await writeFile(
      join(dir, "project", "secrets.md"),
      [
        "# API key sk_live_test_secret_123",
        "## GitHub ghp_abcdefghijklmnopqrstuvwxyz123456",
        "## Google AIzaSyASecretGoogleApiKeyValue123456",
        "## Slack xoxb-1234567890-1234567890-secret",
        "## AWS AKIAIOSFODNN7EXAMPLE",
        "## Owner security.owner@example.com"
      ].join("\n")
    );

    const signals = await scanLocalDocs(dir);
    const serialized = JSON.stringify(signals);

    for (const sensitive of [
      "sk_live_test_secret_123",
      "ghp_abcdefghijklmnopqrstuvwxyz123456",
      "AIzaSyASecretGoogleApiKeyValue123456",
      "xoxb-1234567890-1234567890-secret",
      "AKIAIOSFODNN7EXAMPLE",
      "security.owner@example.com"
    ]) {
      assert.doesNotMatch(serialized, new RegExp(sensitive.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }

    assert.match(serialized, /\[REDACTED_HEADING\]/);
    assert.doesNotMatch(serialized, /API key/);
    assert.doesNotMatch(serialized, /Owner security/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("scanLocalDocs suppresses generic sensitive markdown headings", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-local-docs-sensitive-headings-"));
  try {
    await mkdir(join(dir, "project"), { recursive: true });
    await writeFile(
      join(dir, "project", "headings.md"),
      [
        "# Public Security Overview",
        "## Production password hunter2",
        "## Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
        "## Customer Acme incident",
        "## Private endpoint https://private.example.com/reset"
      ].join("\n")
    );

    const signals = await scanLocalDocs(dir);
    const serialized = JSON.stringify(signals);

    assert.match(serialized, /Public Security Overview/);
    assert.match(serialized, /\[REDACTED_HEADING\]/);
    for (const sensitive of [
      "Production password hunter2",
      "hunter2",
      "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
      "Customer Acme incident",
      "Acme",
      "https://private.example.com/reset"
    ]) {
      assert.doesNotMatch(serialized, new RegExp(sensitive.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("scanLocal writes deterministic local scan output", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-scan-local-"));
  try {
    await initWorkspace(dir);
    await writeFile(join(dir, "package.json"), "{}");
    await writeFile(join(dir, "project", "runbook.md"), "# Incident Runbook\n");

    const result = await scanLocal(dir, new Date("2026-05-28T01:02:03.004Z"));
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.generatedAt, "2026-05-28T01:02:03.004Z");
    assert.equal(result.outputPath, join(dir, "scans", "local-2026-05-28T01-02-03-004Z.json"));

    const output = JSON.parse(await readFile(result.outputPath, "utf8"));
    assert.equal(output.generatedAt, "2026-05-28T01:02:03.004Z");
    assert.equal(output.signals.some((signal: { source: string }) => signal.source === "local-repo"), true);
    assert.equal(output.signals.some((signal: { source: string }) => signal.source === "local-docs"), true);

    const files = await readdir(join(dir, "scans"));
    assert.deepEqual(files, ["local-2026-05-28T01-02-03-004Z.json"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI supports scan --local only", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-scan-cli-"));
  try {
    await initWorkspace(dir);

    const success = spawnSync(process.execPath, [join(process.cwd(), "dist", "cli.js"), "scan", "--local"], {
      cwd: dir,
      encoding: "utf8"
    });
    assert.equal(success.status, 0, success.stderr);
    assert.match(success.stdout, /scans\/local-/);

    for (const args of [["scan"], ["scan", "--local", "extra"], ["scan", "--github"]]) {
      const result = spawnSync(process.execPath, [join(process.cwd(), "dist", "cli.js"), ...args], {
        cwd: dir,
        encoding: "utf8"
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Usage: isms-agent scan --local/);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
