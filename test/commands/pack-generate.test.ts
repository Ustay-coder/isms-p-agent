import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("CLI generates a pack from fixture OpenKB inputs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-cli-pack-generate-"));
  try {
    const openkbRoot = join(process.cwd(), "test", "fixtures", "openkb");
    const packRoot = join(dir, "generated-pack");
    const result = spawnSync(process.execPath, [
      join(process.cwd(), "dist", "cli.js"),
      "pack",
      "generate",
      "--openkb",
      openkbRoot,
      "--pack",
      packRoot,
      "--controls",
      "ISMS-P-2.5.3,ISMS-P-2.5.6"
    ], {
      cwd: process.cwd(),
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /generatedControls/);
    assert.match(result.stdout, /ISMS-P-2\.5\.3/);

    const pack = JSON.parse(await readFile(join(packRoot, "pack.json"), "utf8"));
    assert.equal(pack.name, "generated-pack");
    assert.deepEqual(pack.controls, ["ISMS-P-2.5.3", "ISMS-P-2.5.6"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI rejects incomplete pack generate arguments", () => {
  const result = spawnSync(process.execPath, [
    join(process.cwd(), "dist", "cli.js"),
    "pack",
    "generate",
    "--openkb",
    "test/fixtures/openkb"
  ], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage: ismsp pack generate/);
});
