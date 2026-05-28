import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { scanWorkspace } from "../../src/commands/scan.js";
import { scanGitHub } from "../../src/connectors/github.js";

const TOKEN = "ghp_secret_token_value";

test("scanGitHub emits repository metadata without returning token or API response bodies", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(url), init });
    const path = new URL(String(url)).pathname;

    if (path === "/repos/acme/app") {
      return jsonResponse({ visibility: "private", default_branch: "main" });
    }
    if (path === "/repos/acme/app/branches/main/protection") {
      return jsonResponse({ required_pull_request_reviews: { required_approving_review_count: 1 } });
    }
    if (path === "/repos/acme/app/actions/workflows") {
      return jsonResponse({ total_count: 2, workflows: [{ name: "CI should not be serialized" }] });
    }
    if (path === "/repos/acme/app/contents/.github/dependabot.yml") {
      return jsonResponse({ path: ".github/dependabot.yml", content: "do-not-copy" });
    }
    if (path === "/repos/acme/app/contents/.github/CODEOWNERS") {
      return jsonResponse({ path: ".github/CODEOWNERS", content: "@acme/security" });
    }
    return jsonResponse({ message: "not found" }, 404);
  };

  const signals = await scanGitHub({ repository: "acme/app", token: TOKEN }, fetchMock);
  const serialized = JSON.stringify(signals);

  assert.equal(signals.find((signal) => signal.id === "github:repository")?.metadata.visibility, "private");
  assert.equal(signals.find((signal) => signal.id === "github:default-branch-protection")?.metadata.branchProtected, true);
  assert.equal(signals.find((signal) => signal.id === "github:actions-workflows")?.metadata.workflowCount, 2);
  assert.equal(signals.find((signal) => signal.id === "github:dependabot-config")?.metadata.present, true);
  assert.equal(signals.find((signal) => signal.id === "github:codeowners")?.metadata.present, true);

  assert.doesNotMatch(serialized, new RegExp(TOKEN));
  assert.doesNotMatch(serialized, /CI should not be serialized/);
  assert.doesNotMatch(serialized, /@acme\/security/);
  assert.ok(calls.length > 0);
  for (const call of calls) {
    assert.equal((call.init?.headers as Record<string, string>).Authorization, `Bearer ${TOKEN}`);
    assert.doesNotMatch(call.url, new RegExp(TOKEN));
  }
});

test("scanGitHub turns API failures into needs_confirmation signals", async () => {
  const signals = await scanGitHub({ repository: "acme/app", token: TOKEN }, async () => jsonResponse({ message: "forbidden" }, 403));

  assert.equal(signals.every((signal) => signal.basis === "needs_confirmation"), true);
  assert.match(signals.map((signal) => signal.summary).join("\n"), /GitHub API returned 403/);
});

test("scanWorkspace writes cloud-only scan output and missing-token uncertainty", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-cloud-scan-"));
  const previousToken = process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN;
  try {
    await mkdir(join(dir, "scans"), { recursive: true });
    await writeFile(join(dir, "README.md"), "# App\n");

    const result = await scanWorkspace(dir, { github: "acme/app" }, new Date("2026-05-23T10:00:00.000Z"));

    assert.match(result.outputPath, /scans\/scan-2026-05-23T10-00-00-000Z\.json$/);
    assert.equal(result.signals.length, 1);
    assert.equal(result.signals[0]?.source, "github");
    assert.equal(result.signals[0]?.basis, "needs_confirmation");
    assert.match(result.signals[0]?.summary ?? "", /GITHUB_TOKEN/);
    assert.equal(JSON.parse(await readFile(result.outputPath, "utf8")).signals[0].basis, "needs_confirmation");
  } finally {
    if (previousToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = previousToken;
    }
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI supports cloud scan flags with missing-token uncertainty", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-cloud-scan-cli-"));
  const env = { ...process.env };
  delete env.GITHUB_TOKEN;
  try {
    const result = spawnSync(process.execPath, [join(process.cwd(), "dist", "cli.js"), "scan", "--github", "acme/app"], {
      cwd: dir,
      encoding: "utf8",
      env
    });

    assert.equal(result.status, 0, result.stderr);
    const outputPath = result.stdout.trim();
    assert.match(outputPath, /scans\/scan-/);
    const scan = JSON.parse(await readFile(outputPath, "utf8"));
    assert.equal(scan.signals[0].source, "github");
    assert.equal(scan.signals[0].basis, "needs_confirmation");
    assert.match(scan.signals[0].summary, /GITHUB_TOKEN/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
