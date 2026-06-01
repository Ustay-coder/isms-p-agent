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
    const stripeKey = ["sk", "live", "test_secret_123"].join("_");
    const githubToken = ["ghp", "abcdefghijklmnopqrstuvwxyz123456"].join("_");
    const googleKey = ["AIza", "SyASecretGoogleApiKeyValue123456"].join("");
    const slackToken = ["xoxb", "1234567890", "1234567890", "secret"].join("-");
    const awsKey = ["AKIA", "IOSFODNN7EXAMPLE"].join("");
    await mkdir(join(dir, "project"), { recursive: true });
    await writeFile(
      join(dir, "project", "secrets.md"),
      [
        `# API key ${stripeKey}`,
        `## GitHub ${githubToken}`,
        `## Google ${googleKey}`,
        `## Slack ${slackToken}`,
        `## AWS ${awsKey}`,
        "## Owner security.owner@example.com"
      ].join("\n")
    );

    const signals = await scanLocalDocs(dir);
    const serialized = JSON.stringify(signals);

    for (const sensitive of [
      stripeKey,
      githubToken,
      googleKey,
      slackToken,
      awsKey,
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
    await writeFile(
      join(dir, "project", "runbook.md"),
      [
        "# Incident Runbook",
        "",
        `Do not store this known secret value: ${SECRET_VALUE}`
      ].join("\n")
    );

    const result = await scanLocal(dir, new Date("2026-05-28T01:02:03.004Z"));
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.generatedAt, "2026-05-28T01:02:03.004Z");
    assert.equal(result.outputPath, join(dir, "scans", "local-2026-05-28T01-02-03-004Z.json"));

    const outputContent = await readFile(result.outputPath, "utf8");
    assert.doesNotMatch(outputContent, new RegExp(SECRET_VALUE));

    const output = JSON.parse(outputContent);
    assert.equal(output.generatedAt, "2026-05-28T01:02:03.004Z");
    assert.equal(output.signals.some((signal: { source: string }) => signal.source === "local-repo"), true);
    assert.equal(output.signals.some((signal: { source: string }) => signal.source === "local-docs"), true);

    const files = await readdir(join(dir, "scans"));
    assert.deepEqual(files, ["local-2026-05-28T01-02-03-004Z.json"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("scanLocal scopes local scanners to a target path and skips generated agent directories", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-scan-target-"));
  try {
    await initWorkspace(dir);
    await mkdir(join(dir, "project", "evaluation", "src"), { recursive: true });
    await mkdir(join(dir, "project", "evaluation", ".claude"), { recursive: true });
    await mkdir(join(dir, "project", "evaluation", ".playwright-mcp"), { recursive: true });
    await mkdir(join(dir, "project", "evaluation", ".next"), { recursive: true });
    await mkdir(join(dir, "project", "evaluation", ".open-next"), { recursive: true });
    await mkdir(join(dir, "project", "evaluation", ".planning"), { recursive: true });
    await mkdir(join(dir, "project", "marketing"), { recursive: true });

    await writeFile(join(dir, "project", "evaluation", "package.json"), "{}");
    await writeFile(join(dir, "project", "evaluation", "src", "auth.ts"), "const token = process.env.SESSION_SECRET;");
    await writeFile(join(dir, "project", "evaluation", "SECURITY.md"), "# Authentication Policy\n");
    await writeFile(join(dir, "project", "evaluation", ".claude", "notes.md"), "# Claude Auth Notes\n");
    await writeFile(join(dir, "project", "evaluation", ".playwright-mcp", "trace.md"), "# Playwright Login Trace\n");
    await writeFile(join(dir, "project", "evaluation", ".next", "build.md"), "# Generated Auth Page\n");
    await writeFile(join(dir, "project", "evaluation", ".open-next", "worker.js"), "process.env.GENERATED_SECRET");
    await writeFile(join(dir, "project", "evaluation", ".planning", "PROJECT.md"), "# Planning Auth Notes\n");
    await writeFile(join(dir, "project", "marketing", "package.json"), "{}");
    await writeFile(join(dir, "project", "marketing", "README.md"), "# Marketing Login Copy\n");

    const result = await scanLocal(dir, new Date("2026-05-28T01:02:03.004Z"), { target: "project/evaluation" });
    const serialized = JSON.stringify(result);

    assert.match(serialized, /project\/evaluation\/package\.json/);
    assert.match(serialized, /project\/evaluation\/SECURITY\.md/);
    assert.match(serialized, /project\/evaluation\/src\/auth\.ts/);
    assert.doesNotMatch(serialized, /project\/marketing/);
    assert.doesNotMatch(serialized, /\.claude/);
    assert.doesNotMatch(serialized, /\.playwright-mcp/);
    assert.doesNotMatch(serialized, /\.next/);
    assert.doesNotMatch(serialized, /\.open-next/);
    assert.doesNotMatch(serialized, /\.planning/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("scanLocal rejects targets outside the workspace", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-scan-target-outside-"));
  const outside = await mkdtemp(join(tmpdir(), "isms-agent-scan-outside-"));
  try {
    await initWorkspace(dir);

    await assert.rejects(
      scanLocal(dir, new Date("2026-05-28T01:02:03.004Z"), { target: outside }),
      /inside the workspace/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("scanLocal supports target-relative include and exclude path filters", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-scan-path-filter-"));
  try {
    await initWorkspace(dir);
    await mkdir(join(dir, "project", "evaluation", "src", "generated"), { recursive: true });
    await mkdir(join(dir, "project", "evaluation", "src", "__tests__"), { recursive: true });
    await mkdir(join(dir, "project", "evaluation", "specs"), { recursive: true });
    await mkdir(join(dir, "project", "evaluation", "docs"), { recursive: true });
    await mkdir(join(dir, "project", "evaluation", "docs", "superpowers", "specs"), { recursive: true });

    await writeFile(join(dir, "project", "evaluation", "src", "auth.ts"), "const token = process.env.SESSION_SECRET;");
    await writeFile(join(dir, "project", "evaluation", "src", "generated", "auth.ts"), "const token = process.env.GENERATED_SECRET;");
    await writeFile(join(dir, "project", "evaluation", "src", "__tests__", "auth.test.ts"), "const token = process.env.TEST_SECRET;");
    await writeFile(join(dir, "project", "evaluation", "SECURITY.md"), "# Authentication Policy\n");
    await writeFile(join(dir, "project", "evaluation", "specs", "AUTH.md"), "# Auth Spec\n");
    await writeFile(join(dir, "project", "evaluation", "docs", "security.md"), "# Unselected Security Notes\n");
    await writeFile(join(dir, "project", "evaluation", "docs", "superpowers", "specs", "noise.md"), "# Nested Spec Noise\n");

    const result = await scanLocal(dir, new Date("2026-05-28T01:02:03.004Z"), {
      target: "project/evaluation",
      include: ["src", "SECURITY.md", "specs"],
      exclude: ["src/generated", "__tests__"]
    });
    const serialized = JSON.stringify(result);

    assert.match(serialized, /project\/evaluation\/src\/auth\.ts/);
    assert.match(serialized, /project\/evaluation\/SECURITY\.md/);
    assert.match(serialized, /project\/evaluation\/specs\/AUTH\.md/);
    assert.doesNotMatch(serialized, /project\/evaluation\/src\/generated/);
    assert.doesNotMatch(serialized, /project\/evaluation\/src\/__tests__/);
    assert.doesNotMatch(serialized, /project\/evaluation\/docs/);
    assert.doesNotMatch(serialized, /Nested Spec Noise/);
    assert.doesNotMatch(serialized, /GENERATED_SECRET/);
    assert.doesNotMatch(serialized, /TEST_SECRET/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI supports scan --local with an optional target path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-scan-cli-"));
  try {
    await initWorkspace(dir);
    await mkdir(join(dir, "project", "evaluation"), { recursive: true });
    await mkdir(join(dir, "project", "marketing"), { recursive: true });
    await writeFile(join(dir, "project", "evaluation", "package.json"), "{}");
    await writeFile(join(dir, "project", "marketing", "package.json"), "{}");

    const success = spawnSync(process.execPath, [join(process.cwd(), "dist", "cli.js"), "scan", "--local", "--target", "project/evaluation", "--include", "package.json"], {
      cwd: dir,
      encoding: "utf8"
    });
    assert.equal(success.status, 0, success.stderr);
    assert.match(success.stdout, /scans\/local-/);
    const scan = JSON.parse(await readFile(success.stdout.trim(), "utf8"));
    assert.match(JSON.stringify(scan), /project\/evaluation\/package\.json/);
    assert.doesNotMatch(JSON.stringify(scan), /project\/marketing/);

    for (const args of [["scan"], ["scan", "--local", "extra"], ["scan", "--github"], ["scan", "--target", "project/evaluation"], ["scan", "--include", "project/evaluation"]]) {
      const result = spawnSync(process.execPath, [join(process.cwd(), "dist", "cli.js"), ...args], {
        cwd: dir,
        encoding: "utf8"
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Usage: ismsp scan --local/);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
