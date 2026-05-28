import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export function stringifyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, stringifyJson(value));
}
