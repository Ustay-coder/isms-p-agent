import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { promisify } from "node:util";
import type { EvidenceItem } from "../schemas/evidence.js";

const execFileAsync = promisify(execFile);

const PRIVATE_TRACKED_PREFIXES = [
  "evidence/private/",
  "reviews/",
  "scans/",
  "reports/"
];

const UNSAFE_PUBLIC_CLASSIFICATIONS = new Set(["secret", "personal_data"]);

export interface EvidenceValidateOptions {
  public?: boolean;
}

export interface EvidenceValidationResult {
  valid: boolean;
  workspaceRoot: string;
  public: boolean;
  checkedEvidence: number;
  issues: string[];
  warnings: string[];
}

export async function validateEvidence(
  workspaceRoot: string,
  options: EvidenceValidateOptions = {}
): Promise<EvidenceValidationResult> {
  const publicMode = options.public === true;
  const issues: string[] = [];
  const warnings: string[] = [];

  if (publicMode) {
    for (const path of await gitTrackedPrivatePaths(workspaceRoot)) {
      issues.push(`git-tracked private evidence path is not safe for public release: ${path}`);
    }
  }

  const evidence = await loadEvidenceIndex(workspaceRoot);
  for (const item of evidence) {
    validateEvidenceItem(item, workspaceRoot, publicMode, issues, warnings);
  }

  return {
    valid: issues.length === 0,
    workspaceRoot,
    public: publicMode,
    checkedEvidence: evidence.length,
    issues,
    warnings
  };
}

function validateEvidenceItem(
  item: EvidenceItem,
  workspaceRoot: string,
  publicMode: boolean,
  issues: string[],
  warnings: string[]
): void {
  if (item.supports.length === 0) {
    warnings.push(`evidence ${item.evidence_id} has no requirement mapping.`);
  }

  if (item.lifecycle_status === "accepted" && item.valid_until && Date.parse(item.valid_until) < Date.now()) {
    warnings.push(`accepted evidence ${item.evidence_id} is expired as of ${item.valid_until}.`);
  }

  if (!publicMode) {
    return;
  }

  if (UNSAFE_PUBLIC_CLASSIFICATIONS.has(item.classification)) {
    issues.push(`evidence ${item.evidence_id} classification ${item.classification} cannot be included in public validation.`);
  }

  if (isUnsafePublicLocator(item.locator.value, workspaceRoot)) {
    issues.push(`evidence ${item.evidence_id} locator is unsafe for public output: ${redactPath(item.locator.value, workspaceRoot)}`);
  }

  const credentialPath = credentialLikeMetadataPath(item.metadata);
  if (credentialPath) {
    issues.push(`evidence ${item.evidence_id} contains credential-like metadata at ${credentialPath}.`);
  }
}

async function loadEvidenceIndex(workspaceRoot: string): Promise<EvidenceItem[]> {
  const path = join(workspaceRoot, "evidence", "index.jsonl");
  try {
    return parseJsonl<EvidenceItem>(await readFile(path, "utf8"), path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function parseJsonl<T>(content: string, path: string): T[] {
  const rows: T[] = [];
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }
    try {
      rows.push(JSON.parse(line) as T);
    } catch {
      throw new Error(`Invalid JSONL in ${path} at line ${index + 1}.`);
    }
  }
  return rows;
}

async function gitTrackedPrivatePaths(workspaceRoot: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", workspaceRoot, "ls-files"], {
      encoding: "utf8"
    });
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) => PRIVATE_TRACKED_PREFIXES.some((prefix) => line === prefix.slice(0, -1) || line.startsWith(prefix)));
  } catch {
    return [];
  }
}

function isUnsafePublicLocator(value: string, workspaceRoot: string): boolean {
  const normalized = value.replaceAll("\\", "/");
  if (PRIVATE_TRACKED_PREFIXES.some((prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix))) {
    return true;
  }

  if (!isAbsolute(value)) {
    return false;
  }

  const relativePath = relative(workspaceRoot, value).replaceAll("\\", "/");
  return relativePath.startsWith("..") || relativePath === "" || !relativePath.startsWith("evidence/redacted/");
}

function redactPath(path: string, workspaceRoot: string): string {
  if (!isAbsolute(path)) {
    return path;
  }
  const relativePath = relative(workspaceRoot, path).replaceAll("\\", "/");
  return relativePath.startsWith("..") ? "[absolute-path-redacted]" : relativePath;
}

function credentialLikeMetadataPath(metadata: Record<string, string | number | boolean | string[]>): string | undefined {
  for (const [key, value] of Object.entries(metadata)) {
    const loweredKey = key.toLowerCase();
    if (/(secret|token|password|private.?key|credential|database.?url|api.?key)/i.test(loweredKey)) {
      return key;
    }

    const values = Array.isArray(value) ? value : [value];
    for (const entry of values) {
      if (typeof entry === "string" && looksLikeSecret(entry)) {
        return key;
      }
    }
  }
  return undefined;
}

function looksLikeSecret(value: string): boolean {
  return /(sk_live|sk_test|ghp_|github_pat_|xox[baprs]-|AKIA|-----BEGIN [A-Z ]+PRIVATE KEY-----)/.test(value)
    || /[A-Za-z0-9_=-]{32,}/.test(value);
}
