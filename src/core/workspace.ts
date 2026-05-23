import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const WORKSPACE_DIRECTORIES = [
  "raw",
  "wiki",
  "controls",
  "project",
  "connectors",
  "scans",
  "reports"
] as const;

export async function ensureWorkspaceDirectories(root: string): Promise<void> {
  for (const directory of WORKSPACE_DIRECTORIES) {
    await mkdir(join(root, directory), { recursive: true });
  }
}

export async function writeTextIfMissing(path: string, content: string): Promise<void> {
  try {
    await writeFile(path, content, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }
}
