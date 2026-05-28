import { join } from "node:path";
import { writeJson } from "../core/json.js";
import { scanLocalDocs } from "../scanners/local-docs.js";
import { scanLocalRepo } from "../scanners/local-repo.js";
import type { ScanResult } from "../schemas/scan.js";

export interface LocalScanResult extends ScanResult {
  outputPath: string;
}

export async function scanLocal(workspaceRoot: string, now = new Date()): Promise<LocalScanResult> {
  const generatedAt = now.toISOString();
  const result: ScanResult = {
    schemaVersion: 1,
    generatedAt,
    signals: [
      ...await scanLocalRepo(workspaceRoot),
      ...await scanLocalDocs(workspaceRoot)
    ]
  };
  const outputPath = join(workspaceRoot, "scans", `local-${safeTimestamp(generatedAt)}.json`);
  await writeJson(outputPath, result);
  return { ...result, outputPath };
}

function safeTimestamp(isoTimestamp: string): string {
  return isoTimestamp.replaceAll(":", "-").replace(".", "-");
}
