import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const scannerPath = join(process.cwd(), "scripts", "public-safety-scan.mjs");

test("public safety scan checks untracked non-ignored files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-public-safety-untracked-"));
  try {
    execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
    await writeFile(join(dir, "README.md"), "# Public Fixture\n");

    const localPath = ["", "Users", "example", "private", "review.md"].join("/");
    await writeFile(join(dir, "unsafe.md"), `source ${localPath}\n`);

    const result = spawnSync(process.execPath, [scannerPath], {
      cwd: dir,
      encoding: "utf8"
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unsafe\.md:1/);
    assert.match(result.stderr, /local absolute user path/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("public safety scan ignores untracked files covered by gitignore", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-public-safety-ignored-"));
  try {
    execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
    await writeFile(join(dir, ".gitignore"), "private.md\n");

    const localPath = ["", "Users", "example", "private", "review.md"].join("/");
    await writeFile(join(dir, "private.md"), `source ${localPath}\n`);

    const result = spawnSync(process.execPath, [scannerPath], {
      cwd: dir,
      encoding: "utf8"
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Public safety scan passed/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
