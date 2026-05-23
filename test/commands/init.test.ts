import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { initWorkspace } from "../../src/commands/init.js";

test("initWorkspace creates the ISMS-P workspace contract", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-init-"));
  try {
    await initWorkspace(dir);

    for (const name of ["raw", "wiki", "controls", "project", "connectors", "scans", "reports"]) {
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

    await initWorkspace(dir);

    assert.equal(await readFile(join(dir, "AGENTS.md"), "utf8"), "existing agents");
    assert.equal(await readFile(join(dir, "log.md"), "utf8"), "existing log");
    assert.equal(await readFile(join(dir, "isms-agent.config.json"), "utf8"), "{\"schemaVersion\":99}\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
