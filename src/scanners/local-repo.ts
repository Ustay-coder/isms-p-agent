import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { workspaceRelativePath } from "../core/provenance.js";
import type { ScanSignal } from "../schemas/scan.js";

const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", ".git", "scans", "reports"]);
const DEPENDENCY_MANIFESTS = new Set([
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "deno.json",
  "requirements.txt",
  "pyproject.toml",
  "poetry.lock",
  "Pipfile",
  "go.mod",
  "Cargo.toml",
  "Gemfile",
  "composer.json"
]);
const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".conf",
  ".env",
  ".js",
  ".json",
  ".jsx",
  ".mjs",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml"
]);

const KEYWORD_PATTERNS = [
  { name: "auth", pattern: /\b(auth|oauth|login|password|credential|jwt|token)\b/i },
  { name: "session", pattern: /\b(session|cookie|csrf|sameSite)\b/i },
  { name: "logging", pattern: /\b(log|logger|audit|console\.)\b/i }
] as const;

const ENV_PATTERNS = [
  /process\.env\.([A-Z_][A-Z0-9_]*)/g,
  /process\.env\[['"]([A-Z_][A-Z0-9_]*)['"]\]/g,
  /import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g
];
const DOTENV_NAME_PATTERN = /^([A-Z_][A-Z0-9_]*)\s*=/gm;

interface RepoFile {
  absolutePath: string;
  relativePath: string;
}

export async function scanLocalRepo(root: string): Promise<ScanSignal[]> {
  const files = await listRepoFiles(root);
  const dependencyManifestPaths = files
    .filter((file) => DEPENDENCY_MANIFESTS.has(basename(file.relativePath)))
    .map((file) => file.relativePath)
    .sort();
  const ciWorkflowPaths = files
    .filter((file) => file.relativePath.startsWith(".github/workflows/"))
    .map((file) => file.relativePath)
    .sort();

  const keywordPaths = new Map<string, Set<string>>();
  const envVars = new Set<string>();
  const envVarPaths = new Set<string>();

  for (const file of files.filter(isLikelyTextFile)) {
    const content = await readFile(file.absolutePath, "utf8");

    for (const { name, pattern } of KEYWORD_PATTERNS) {
      if (pattern.test(content)) {
        const paths = keywordPaths.get(name) ?? new Set<string>();
        paths.add(file.relativePath);
        keywordPaths.set(name, paths);
      }
    }

    for (const pattern of ENV_PATTERNS) {
      pattern.lastIndex = 0;
      for (const match of content.matchAll(pattern)) {
        if (match[1]) {
          envVars.add(match[1]);
          envVarPaths.add(file.relativePath);
        }
      }
    }

    if (basename(file.relativePath).startsWith(".env")) {
      DOTENV_NAME_PATTERN.lastIndex = 0;
      for (const match of content.matchAll(DOTENV_NAME_PATTERN)) {
        if (match[1]) {
          envVars.add(match[1]);
          envVarPaths.add(file.relativePath);
        }
      }
    }
  }

  const signals: ScanSignal[] = [];
  if (dependencyManifestPaths.length > 0) {
    signals.push({
      id: "local-repo:dependency-manifests",
      source: "local-repo",
      basis: "observed",
      summary: `Detected ${dependencyManifestPaths.length} dependency manifest file(s).`,
      paths: dependencyManifestPaths,
      metadata: { count: dependencyManifestPaths.length, manifestNames: dependencyManifestPaths.map((path) => basename(path)) }
    });
  }

  if (ciWorkflowPaths.length > 0) {
    signals.push({
      id: "local-repo:ci-workflows",
      source: "local-repo",
      basis: "observed",
      summary: `Detected ${ciWorkflowPaths.length} GitHub Actions workflow file(s).`,
      paths: ciWorkflowPaths,
      metadata: { count: ciWorkflowPaths.length }
    });
  }

  if (keywordPaths.size > 0) {
    const paths = [...new Set([...keywordPaths.values()].flatMap((value) => [...value]))].sort();
    signals.push({
      id: "local-repo:auth-session-logging-keywords",
      source: "local-repo",
      basis: "inferred",
      summary: "Detected auth/session/logging implementation keyword categories.",
      paths,
      metadata: {
        categories: [...keywordPaths.keys()].sort(),
        fileCount: paths.length
      }
    });
  }

  if (envVars.size > 0) {
    signals.push({
      id: "local-repo:env-vars",
      source: "local-repo",
      basis: "observed",
      summary: `Detected ${envVars.size} environment variable name(s).`,
      paths: [...envVarPaths].sort(),
      metadata: { envVars: [...envVars].sort(), count: envVars.size }
    });
  }

  return signals;
}

async function listRepoFiles(root: string, current = root): Promise<RepoFile[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: RepoFile[] = [];

  for (const entry of entries) {
    const absolutePath = join(current, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      files.push(...await listRepoFiles(root, absolutePath));
      continue;
    }

    if (entry.isFile()) {
      files.push({ absolutePath, relativePath: workspaceRelativePath(root, absolutePath) });
    }
  }

  return files;
}

function isLikelyTextFile(file: RepoFile): boolean {
  const extension = extname(file.relativePath).toLowerCase();
  return TEXT_EXTENSIONS.has(extension) || basename(file.relativePath).startsWith(".env");
}
