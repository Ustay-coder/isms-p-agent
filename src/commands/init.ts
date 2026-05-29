import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureWorkspaceDirectories, writeTextIfMissing } from "../core/workspace.js";

const AGENTS_TEMPLATE = `# AGENTS.md

## ISMS-P Agent Operating Rules

- Treat raw source files as immutable. Do not edit files under raw/.
- Do not treat evidence existence as control satisfaction.
- Do not treat draft policy text as operational evidence.
- Keep GitHub, Vercel, and Cloudflare operations read-only in the MVP.
- Mark every judgment basis as observed, document-backed, inferred, or needs_confirmation.
- Do not collect secrets, customer records, or PII.
- Preserve source references for wiki, control, scan, and report outputs.
- Surface real gaps. Do not hide gaps behind alternative evidence.
`;

const CONFIG_TEMPLATE = {
  schemaVersion: 1,
  workspaceKind: "isms-p-agent",
  createdBy: "isms-agent init",
  reportFormats: ["markdown"]
};

const GITIGNORE_RULES = [
  "/evidence/private/",
  "/reviews/",
  "/scans/",
  "/reports/",
  "*.secret.*",
  "*.private.*"
];

export async function initWorkspace(root: string): Promise<void> {
  await ensureWorkspaceDirectories(root);
  await writeTextIfMissing(join(root, "AGENTS.md"), AGENTS_TEMPLATE);
  await writeTextIfMissing(join(root, "log.md"), "# ISMS-P Agent Log\n");
  await writeTextIfMissing(
    join(root, "isms-agent.config.json"),
    `${JSON.stringify(CONFIG_TEMPLATE, null, 2)}\n`
  );
  await ensureGitignoreRules(join(root, ".gitignore"), GITIGNORE_RULES);
}

async function ensureGitignoreRules(path: string, rules: string[]): Promise<void> {
  let existing = "";
  try {
    existing = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const existingLines = new Set(existing.split(/\r?\n/).map((line) => line.trim()));
  const missing = rules.filter((rule) => !existingLines.has(rule));
  if (missing.length === 0) {
    return;
  }

  const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  await writeFile(path, `${existing}${prefix}${missing.join("\n")}\n`);
}
