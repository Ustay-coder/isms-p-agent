import { stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
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
  target?: string;
  include?: string[];
  exclude?: string[];
  github?: string;
  vercel?: string;
  cloudflare?: string;
}

export interface LocalScanOptions {
  target?: string;
  include?: string[];
  exclude?: string[];
}

export async function scanLocal(workspaceRoot: string, now = new Date(), options: LocalScanOptions = {}): Promise<LocalScanResult> {
  const generatedAt = now.toISOString();
  const targetRoot = await resolveLocalTarget(workspaceRoot, options.target);
  const result: ScanResult = {
    schemaVersion: 1,
    generatedAt,
    signals: [
      ...await scanLocalRepo(targetRoot, { workspaceRoot, pathFilter: options }),
      ...await scanLocalDocs(targetRoot, { workspaceRoot, pathFilter: options })
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
    const targetRoot = await resolveLocalTarget(workspaceRoot, options.target);
    signals.push(...await scanLocalRepo(targetRoot, { workspaceRoot, pathFilter: options }));
    signals.push(...await scanLocalDocs(targetRoot, { workspaceRoot, pathFilter: options }));
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

async function resolveLocalTarget(workspaceRoot: string, target?: string): Promise<string> {
  const resolvedWorkspace = resolve(workspaceRoot);
  const resolvedTarget = target ? resolve(resolvedWorkspace, target) : resolvedWorkspace;
  const targetRelativePath = relative(resolvedWorkspace, resolvedTarget);

  if (targetRelativePath === ".." || targetRelativePath.startsWith(`..${sep}`) || isAbsolute(targetRelativePath)) {
    throw new Error(`Scan target must be inside the workspace: ${target}`);
  }

  const targetStat = await stat(resolvedTarget);
  if (!targetStat.isDirectory()) {
    throw new Error(`Scan target must be a directory: ${target}`);
  }

  return resolvedTarget;
}
