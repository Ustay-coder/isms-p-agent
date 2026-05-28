import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { workspaceRelativePath } from "../core/provenance.js";
import type { ScanSignal } from "../schemas/scan.js";
import { pathMatchesFilter, type ScanPathFilter } from "./path-filter.js";

const SKIPPED_DIRECTORIES = new Set([
  ".claude",
  ".git",
  ".next",
  ".open-next",
  ".playwright-mcp",
  ".planning",
  ".turbo",
  ".wrangler",
  "coverage",
  "dist",
  "node_modules",
  "reports",
  "scans"
]);
const DOCUMENT_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);
const HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*#*\s*$/gm;
const REDACTED_HEADING = "[REDACTED_HEADING]";
const SENSITIVE_HEADING_PATTERNS = [
  /\b(password|passwd|secret|token|apikey|bearer|jwt|private|customer|client|incident)\b/i,
  /\bapi\s+key\b/i,
  /\bsk_(?:live|test)_[A-Za-z0-9_-]+\b/,
  /\bghp_[A-Za-z0-9_]+\b/,
  /\bAIza[A-Za-z0-9_-]+\b/,
  /\bxoxb-[A-Za-z0-9-]+\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\b(?:https?:\/\/|www\.)\S+\b/i
];

interface DocumentFile {
  absolutePath: string;
  relativePath: string;
  targetRelativePath: string;
}

export interface LocalDocsScanOptions {
  workspaceRoot?: string;
  pathFilter?: ScanPathFilter;
}

export async function scanLocalDocs(root: string, options: LocalDocsScanOptions = {}): Promise<ScanSignal[]> {
  const files = (await listDocumentFiles(root, options.workspaceRoot ?? root))
    .filter((file) => pathMatchesFilter(file.targetRelativePath, options.pathFilter))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  if (files.length === 0) {
    return [];
  }

  const headingPaths = new Set<string>();
  const headings: string[] = [];

  for (const file of files.filter(isMarkdownFile)) {
    const content = await readFile(file.absolutePath, "utf8");
    HEADING_PATTERN.lastIndex = 0;
    for (const match of content.matchAll(HEADING_PATTERN)) {
      const heading = match[2]?.trim();
      if (heading) {
        headings.push(`${file.relativePath}#${redactHeading(heading)}`);
        headingPaths.add(file.relativePath);
      }
    }
  }

  return [
    {
      id: "local-docs:documents",
      source: "local-docs",
      basis: "document-backed",
      summary: `Indexed ${files.length} local document file(s).`,
      paths: files.map((file) => file.relativePath),
      metadata: {
        count: files.length,
        filenames: files.map((file) => file.relativePath)
      }
    },
    ...(headings.length > 0
      ? [{
          id: "local-docs:markdown-headings",
          source: "local-docs" as const,
          basis: "document-backed" as const,
          summary: `Indexed ${headings.length} Markdown heading(s).`,
          paths: [...headingPaths].sort(),
          metadata: {
            count: headings.length,
            headings: headings.sort()
          }
        }]
      : [])
  ];
}

async function listDocumentFiles(root: string, workspaceRoot: string, current = root): Promise<DocumentFile[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: DocumentFile[] = [];

  for (const entry of entries) {
    const absolutePath = join(current, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      files.push(...await listDocumentFiles(root, workspaceRoot, absolutePath));
      continue;
    }

    if (entry.isFile() && DOCUMENT_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      files.push({
        absolutePath,
        relativePath: workspaceRelativePath(workspaceRoot, absolutePath),
        targetRelativePath: workspaceRelativePath(root, absolutePath)
      });
    }
  }

  return files;
}

function isMarkdownFile(file: DocumentFile): boolean {
  return MARKDOWN_EXTENSIONS.has(extname(file.relativePath).toLowerCase());
}

function redactHeading(heading: string): string {
  return SENSITIVE_HEADING_PATTERNS.some((pattern) => pattern.test(heading))
    ? REDACTED_HEADING
    : heading;
}
