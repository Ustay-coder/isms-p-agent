import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { initWorkspace } from "../../src/commands/init.js";

test("initWorkspace creates the ISMS-P workspace contract", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-init-"));
  try {
    await initWorkspace(dir);

    for (const name of ["raw", "wiki", "controls", "project", "connectors", "scans", "reports", "evidence", "evidence/private", "evidence/redacted", "reviews"]) {
      assert.equal((await stat(join(dir, name))).isDirectory(), true);
    }

    const agents = await readFile(join(dir, "AGENTS.md"), "utf8");
    assert.match(agents, /raw source/i);
    assert.match(agents, /read-only/i);
    assert.match(agents, /control satisfaction/i);

    const log = await readFile(join(dir, "log.md"), "utf8");
    assert.match(log, /^# ISMS-P Agent Log/m);

    const config = JSON.parse(await readFile(join(dir, "isms-agent.config.json"), "utf8"));
    assert.equal(config.schemaVersion, 1);

    const gitignore = await readFile(join(dir, ".gitignore"), "utf8");
    assert.match(gitignore, /^\/evidence\/private\/$/m);
    assert.match(gitignore, /^\/reviews\/$/m);
    assert.match(gitignore, /^\/scans\/$/m);
    assert.match(gitignore, /^\/reports\/$/m);
    assert.match(gitignore, /^\*\.secret\.\*$/m);
    assert.match(gitignore, /^\*\.private\.\*$/m);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("initWorkspace does not overwrite existing files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-init-"));
  try {
    await writeFile(join(dir, "AGENTS.md"), "existing agents");
    await writeFile(join(dir, "log.md"), "existing log");
    await writeFile(join(dir, "isms-agent.config.json"), "{\"schemaVersion\":99}\n");
    await writeFile(join(dir, ".gitignore"), "existing\n/reviews/\n");

    await initWorkspace(dir);

    assert.equal(await readFile(join(dir, "AGENTS.md"), "utf8"), "existing agents");
    assert.equal(await readFile(join(dir, "log.md"), "utf8"), "existing log");
    assert.equal(await readFile(join(dir, "isms-agent.config.json"), "utf8"), "{\"schemaVersion\":99}\n");
    const gitignore = await readFile(join(dir, ".gitignore"), "utf8");
    assert.match(gitignore, /^existing$/m);
    assert.equal((gitignore.match(/^\/reviews\/$/gm) ?? []).length, 1);
    assert.match(gitignore, /^\/evidence\/private\/$/m);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI rejects init arguments without mutating cwd", async () => {
  for (const args of [["init", "--help"], ["init", "typo"]]) {
    const dir = await mkdtemp(join(tmpdir(), "isms-agent-cli-"));
    try {
      const result = spawnSync(process.execPath, [join(process.cwd(), "dist", "cli.js"), ...args], {
        cwd: dir,
        encoding: "utf8"
      });

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Usage: ismsp init/);

      for (const name of ["raw", "wiki", "controls", "project", "connectors", "scans", "reports", "evidence", "reviews"]) {
        await assert.rejects(stat(join(dir, name)), { code: "ENOENT" });
      }
      await assert.rejects(stat(join(dir, "AGENTS.md")), { code: "ENOENT" });
      await assert.rejects(stat(join(dir, "log.md")), { code: "ENOENT" });
      await assert.rejects(stat(join(dir, "isms-agent.config.json")), { code: "ENOENT" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});
