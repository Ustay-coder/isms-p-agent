import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { initWorkspace } from "../../src/commands/init.js";
import { ingestSource } from "../../src/commands/ingest.js";

const SOURCE = `# ISMS-P Controls

## 2.5.3 사용자 인증

정보시스템과 중요 정보에 접근하는 사용자는 안전한 인증 절차를 거쳐야 한다.

인증 수단은 업무 특성과 위험도를 고려하여 적용한다.
`;

test("ingestSource parses raw Markdown controls and writes provenance outputs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-ingest-"));
  try {
    await initWorkspace(dir);
    const sourcePath = join(dir, "raw", "isms-p.md");
    await writeFile(sourcePath, SOURCE);

    const result = await ingestSource(dir, sourcePath);

    const sha256 = createHash("sha256").update(SOURCE).digest("hex");
    assert.equal(result.controls.length, 1);
    assert.equal(result.controls[0]?.control_id, "2.5.3");
    assert.equal(result.controls[0]?.title, "사용자 인증");
    assert.equal(result.controls[0]?.automation_potential, "partial");
    assert.equal(result.controls[0]?.human_review_required, true);
    assert.deepEqual(result.controls[0]?.source_refs, [
      {
        sourcePath: "raw/isms-p.md",
        sha256,
        excerpt: "## 2.5.3 사용자 인증"
      }
    ]);

    const control = JSON.parse(await readFile(join(dir, "controls", "2.5.3.json"), "utf8"));
    assert.equal(control.control_id, "2.5.3");
    assert.equal(control.title, "사용자 인증");
    assert.match(control.requirement, /안전한 인증 절차/);
    assert.equal(control.automation_potential, "partial");
    assert.equal(control.human_review_required, true);
    assert.deepEqual(control.applicability_questions, []);

    const controlJson = await readFile(join(dir, "controls", "2.5.3.json"), "utf8");
    assert.match(controlJson, /\n$/);
    assert.match(controlJson, /^  "control_id": "2\.5\.3",$/m);

    const sourceIndex = await readFile(join(dir, "wiki", "sources", "raw_isms-p.md.md"), "utf8");
    assert.match(sourceIndex, /Source: raw\/isms-p\.md/);
    assert.match(sourceIndex, new RegExp(`SHA-256: ${sha256}`));

    const log = await readFile(join(dir, "log.md"), "utf8");
    assert.match(log, /ingest \| raw\/isms-p\.md -> 1 controls/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ingestSource rejects sources outside raw", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-ingest-"));
  try {
    await initWorkspace(dir);
    const sourcePath = join(dir, "project", "outside.md");
    await writeFile(sourcePath, SOURCE);

    await assert.rejects(
      ingestSource(dir, sourcePath),
      /Source must be inside raw\//
    );

    await assert.rejects(stat(join(dir, "controls", "2.5.3.json")), { code: "ENOENT" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ingestSource rejects raw symlinks that resolve outside raw", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-ingest-"));
  try {
    await initWorkspace(dir);
    const outsidePath = join(dir, "project", "outside.md");
    const sourcePath = join(dir, "raw", "linked.md");
    await writeFile(outsidePath, SOURCE);
    await symlink(outsidePath, sourcePath);

    await assert.rejects(
      ingestSource(dir, sourcePath),
      /Source must be inside raw\//
    );

    await assert.rejects(stat(join(dir, "controls", "2.5.3.json")), { code: "ENOENT" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ingestSource rejects non-Markdown files inside raw", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-ingest-"));
  try {
    await initWorkspace(dir);
    const sourcePath = join(dir, "raw", "isms-p.txt");
    await writeFile(sourcePath, SOURCE);

    await assert.rejects(
      ingestSource(dir, sourcePath),
      /Source must be a Markdown file/
    );

    await assert.rejects(stat(join(dir, "controls", "2.5.3.json")), { code: "ENOENT" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ingestSource keeps source indexes distinct for duplicate basenames", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-ingest-"));
  try {
    await initWorkspace(dir);
    await mkdir(join(dir, "raw", "a"), { recursive: true });
    await mkdir(join(dir, "raw", "b"), { recursive: true });
    await writeFile(join(dir, "raw", "a", "isms-p.md"), SOURCE);
    await writeFile(join(dir, "raw", "b", "isms-p.md"), SOURCE);

    await ingestSource(dir, join(dir, "raw", "a", "isms-p.md"));
    await ingestSource(dir, join(dir, "raw", "b", "isms-p.md"));

    const first = await readFile(join(dir, "wiki", "sources", "raw_a_isms-p.md.md"), "utf8");
    const second = await readFile(join(dir, "wiki", "sources", "raw_b_isms-p.md.md"), "utf8");
    assert.match(first, /Source: raw\/a\/isms-p\.md/);
    assert.match(second, /Source: raw\/b\/isms-p\.md/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI supports ingest with exactly one raw file argument", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-ingest-cli-"));
  try {
    await initWorkspace(dir);
    await writeFile(join(dir, "raw", "isms-p.md"), SOURCE);

    const success = spawnSync(process.execPath, [join(process.cwd(), "dist", "cli.js"), "ingest", "raw/isms-p.md"], {
      cwd: dir,
      encoding: "utf8"
    });
    assert.equal(success.status, 0, success.stderr);
    assert.equal(JSON.parse(await readFile(join(dir, "controls", "2.5.3.json"), "utf8")).control_id, "2.5.3");

    for (const args of [["ingest"], ["ingest", "raw/isms-p.md", "extra"]]) {
      const result = spawnSync(process.execPath, [join(process.cwd(), "dist", "cli.js"), ...args], {
        cwd: dir,
        encoding: "utf8"
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Usage: ismsp ingest <raw-file>/);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
