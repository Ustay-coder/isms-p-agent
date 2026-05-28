import { readFile } from "node:fs/promises";
import { basename } from "node:path";

export async function readJsonl<T>(path: string): Promise<T[]> {
  const content = await readFile(path, "utf8");
  const records: T[] = [];
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }

    try {
      records.push(JSON.parse(line) as T);
    } catch {
      throw new Error(`${basename(path)} line ${index + 1} is not valid JSON`);
    }
  }

  return records;
}
