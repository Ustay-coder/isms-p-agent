import { join } from "node:path";
import { scanCloudflare } from "../connectors/cloudflare.js";
import { scanGitHub } from "../connectors/github.js";
import { scanVercel } from "../connectors/vercel.js";
import { writeJson } from "../core/json.js";
import { scanLocalDocs } from "../scanners/local-docs.js";
import { scanLocalRepo } from "../scanners/local-repo.js";
import type { ScanResult } from "../schemas/scan.js";

export interface LocalScanResult extends ScanResult {
  outputPath: string;
}

export interface ScanOptions {
  local?: boolean;
  github?: string;
  vercel?: string;
  cloudflare?: string;
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

export async function scanWorkspace(workspaceRoot: string, options: ScanOptions, now = new Date()): Promise<LocalScanResult> {
  const generatedAt = now.toISOString();
  const signals = [];

  if (options.local) {
    signals.push(...await scanLocalRepo(workspaceRoot));
    signals.push(...await scanLocalDocs(workspaceRoot));
  }

  if (options.github) {
    signals.push(...await scanGitHub({ repository: options.github, token: process.env.GITHUB_TOKEN }));
  }

  if (options.vercel) {
    signals.push(...await scanVercel({ project: options.vercel, token: process.env.VERCEL_TOKEN }));
  }

  if (options.cloudflare) {
    signals.push(...await scanCloudflare({ zone: options.cloudflare, token: process.env.CLOUDFLARE_API_TOKEN }));
  }

  const result: ScanResult = {
    schemaVersion: 1,
    generatedAt,
    signals
  };
  const outputPath = join(workspaceRoot, "scans", `scan-${safeTimestamp(generatedAt)}.json`);
  await writeJson(outputPath, result);
  return { ...result, outputPath };
}

function safeTimestamp(isoTimestamp: string): string {
  return isoTimestamp.replaceAll(":", "-").replace(".", "-");
}
