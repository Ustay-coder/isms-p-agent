import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { scanLocalRepo } from "../../src/scanners/local-repo.js";

const SECRET_VALUE = "sk_test_secret_value_123";

test("scanLocalRepo detects repo metadata without storing source contents or secret values", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-local-repo-"));
  try {
    await mkdir(join(dir, ".github", "workflows"), { recursive: true });
    await mkdir(join(dir, "src"), { recursive: true });
    await mkdir(join(dir, "node_modules", "hidden"), { recursive: true });

    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "service", dependencies: { express: "1.0.0" } }));
    await writeFile(join(dir, ".github", "workflows", "ci.yml"), "name: CI\non: [push]\n");
    await writeFile(
      join(dir, "src", "auth.ts"),
      [
        "const sessionCookie = process.env.SESSION_SECRET;",
        `const token = "${SECRET_VALUE}";`,
        "console.log('audit event');"
      ].join("\n")
    );
    await writeFile(join(dir, "node_modules", "hidden", "package.json"), "{}");

    const signals = await scanLocalRepo(dir);
    const serialized = JSON.stringify(signals);

    assert.match(serialized, /package\.json/);
    assert.match(serialized, /\.github\/workflows\/ci\.yml/);
    assert.match(serialized, /auth\/session\/logging/i);
    assert.match(serialized, /SESSION_SECRET/);
    assert.doesNotMatch(serialized, new RegExp(SECRET_VALUE));
    assert.doesNotMatch(serialized, /express/);
    assert.doesNotMatch(serialized, /node_modules\/hidden/);

    const envSignal = signals.find((signal: { id: string }) => signal.id === "local-repo:env-vars");
    assert.deepEqual(envSignal?.metadata.envVars, ["SESSION_SECRET"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
