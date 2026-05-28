import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

export async function sha256File(path: string): Promise<string> {
  const content = await readFile(path);
  return createHash("sha256").update(content).digest("hex");
}

export function workspaceRelativePath(workspaceRoot: string, path: string): string {
  return relative(resolve(workspaceRoot), resolve(path)).split(sep).join("/");
}

export function assertInsideDirectory(parent: string, child: string, message: string): void {
  const parentResolved = resolve(parent);
  const childResolved = resolve(child);
  const relativePath = relative(parentResolved, childResolved);

  if (relativePath === "" || relativePath.startsWith("..") || relativePath.includes(`..${sep}`)) {
    throw new Error(message);
  }
}

export async function assertRealPathInsideDirectory(parent: string, child: string, message: string): Promise<string> {
  const parentRealPath = await realpath(parent);
  const childRealPath = await realpath(child);
  assertInsideDirectory(parentRealPath, childRealPath, message);
  return childRealPath;
}
