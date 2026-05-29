import { constants } from "node:fs";
import { copyFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { generatePackFromOpenKb } from "../generator/openkb-pack.js";
import type { GeneratePackResult } from "../generator/openkb-types.js";
import type { ControlKnowledge, SourceRef } from "../schemas/control.js";

const RAW_LEGAL_PROFILE = "raw/legal/7의2_ISMS-P_인증기준_항목_목록.jsonl";
const PUBLIC_PACK_FORBIDDEN_PATTERNS = [
  { label: "private absolute path", pattern: /\/Users\// },
  { label: "private service path", pattern: /apps\/evaluation/ },
  { label: "private overlay path", pattern: /overlays\/evaluate-club/ },
  { label: "private asset-map reference", pattern: /evaluate\.club asset map/ },
  {
    label: "credential-looking value",
    pattern: /["']?\b(?:api[_-]?key|token|secret)\b["']?\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{12,}/i
  }
];

export interface PackValidationResult {
  valid: boolean;
  packRoot: string;
  checkedControls: number;
  issues: string[];
}

export interface PackGenerateCliOptions {
  openkbRoot: string;
  packRoot: string;
  controlIds: string[];
  version: string;
}

export interface PackInstallOptions {
  packRoot: string;
  overwrite?: boolean;
}

export interface PackInstallResult {
  packRoot: string;
  outputDir: string;
  installedControls: number;
  skippedControls: string[];
}

export function parsePackGenerateArgs(args: string[]): PackGenerateCliOptions | undefined {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--openkb" || arg === "--pack" || arg === "--controls" || arg === "--version") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        return undefined;
      }
      values.set(arg, value);
      index += 1;
      continue;
    }
    return undefined;
  }

  const openkbRoot = values.get("--openkb");
  const packRoot = values.get("--pack");
  const controls = values.get("--controls");
  if (!openkbRoot || !packRoot || !controls) {
    return undefined;
  }

  const controlIds = controls.split(",").map((controlId) => controlId.trim()).filter(Boolean);
  if (controlIds.length === 0) {
    return undefined;
  }

  return {
    openkbRoot,
    packRoot,
    controlIds,
    version: values.get("--version") ?? "0.1.0"
  };
}

export async function generatePack(options: PackGenerateCliOptions): Promise<GeneratePackResult> {
  const packRoot = resolve(process.cwd(), options.packRoot);
  return generatePackFromOpenKb({
    openkbRoot: resolve(process.cwd(), options.openkbRoot),
    packRoot,
    packName: basename(packRoot),
    version: options.version,
    controlIds: options.controlIds
  });
}

export async function installPack(workspaceRoot: string, options: PackInstallOptions): Promise<PackInstallResult> {
  const packRoot = resolve(process.cwd(), options.packRoot);
  const validation = await validatePack(packRoot);
  if (!validation.valid) {
    throw new Error(`Pack is invalid and cannot be installed: ${validation.issues.join("; ")}`);
  }

  const controlsRoot = join(packRoot, "controls");
  const outputDir = join(workspaceRoot, "controls");
  await mkdir(outputDir, { recursive: true });

  const skippedControls: string[] = [];
  let installedControls = 0;
  for (const name of await jsonControlFileNames(controlsRoot)) {
    const source = join(controlsRoot, name);
    const destination = join(outputDir, name);
    try {
      await copyFile(source, destination, options.overwrite ? 0 : constants.COPYFILE_EXCL);
      installedControls += 1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        const [sourceContent, destinationContent] = await Promise.all([
          readFile(source, "utf8"),
          readFile(destination, "utf8")
        ]);
        if (sourceContent === destinationContent) {
          installedControls += 1;
        } else {
          skippedControls.push(name);
        }
        continue;
      }
      throw error;
    }
  }

  return { packRoot, outputDir, installedControls, skippedControls };
}

interface PackManifest {
  schemaVersion?: number;
  name?: string;
  sourceOfTruth?: string;
  controlCount?: number;
  controls?: string[];
}

interface SourceManifest {
  sourceOfTruth?: string;
  openkbSources?: string[];
  sourceProfileReferences?: Array<{ path?: string; purpose?: string }>;
  privateOverlaysIncluded?: boolean;
}

export async function validatePack(packRoot: string): Promise<PackValidationResult> {
  const issues: string[] = [];

  const packManifest = await readJsonFile<PackManifest>(packRoot, "pack.json", issues);
  const sourceManifest = await readJsonFile<SourceManifest>(packRoot, "sources/source-manifest.json", issues);
  const controls = await readControls(packRoot, issues);

  validatePackManifest(packManifest, controls, issues);
  validateSourceManifest(sourceManifest, issues);

  const seenControlIds = new Set<string>();
  for (const control of controls) {
    validateControl(control.path, control.content, control.parsed, seenControlIds, issues);
  }

  return {
    valid: issues.length === 0,
    packRoot,
    checkedControls: controls.length,
    issues
  };
}

function validatePackManifest(
  manifest: PackManifest | undefined,
  controls: Array<{ parsed: ControlKnowledge }>,
  issues: string[]
): void {
  if (!manifest) {
    return;
  }

  if (manifest.sourceOfTruth !== "openkb") {
    issues.push("pack.json sourceOfTruth must be openkb");
  }

  if (typeof manifest.controlCount === "number" && manifest.controlCount !== controls.length) {
    issues.push(`pack.json controlCount ${manifest.controlCount} does not match controls directory count ${controls.length}`);
  }

  if (Array.isArray(manifest.controls)) {
    const actualIds = controls.map((control) => control.parsed.control_id).sort();
    const manifestIds = [...manifest.controls].sort();
    if (JSON.stringify(actualIds) !== JSON.stringify(manifestIds)) {
      issues.push("pack.json controls must match control JSON control_id values");
    }
  }
}

function validateSourceManifest(manifest: SourceManifest | undefined, issues: string[]): void {
  if (!manifest) {
    return;
  }

  if (manifest.sourceOfTruth !== "openkb") {
    issues.push("source-manifest.json sourceOfTruth must be openkb");
  }

  if (manifest.privateOverlaysIncluded !== false) {
    issues.push("source-manifest.json privateOverlaysIncluded must be false for public packs");
  }

  if (manifest.openkbSources?.some((source) => source.startsWith("raw/legal/"))) {
    issues.push("source-manifest.json must not list raw legal profile rows as direct openkbSources");
  }
}

function validateControl(
  path: string,
  content: string,
  control: ControlKnowledge,
  seenControlIds: Set<string>,
  issues: string[]
): void {
  const location = relative(process.cwd(), path);
  const controlId = control.control_id || location;

  if (seenControlIds.has(control.control_id)) {
    issues.push(`${controlId} duplicates another control_id`);
  }
  seenControlIds.add(control.control_id);

  for (const forbidden of PUBLIC_PACK_FORBIDDEN_PATTERNS) {
    if (forbidden.pattern.test(content)) {
      issues.push(`${controlId} contains ${forbidden.label}`);
    }
  }

  if (control.pack?.source_of_truth !== "openkb") {
    issues.push(`${controlId} pack.source_of_truth must be openkb`);
  }

  if (!Array.isArray(control.source_refs) || control.source_refs.length === 0) {
    issues.push(`${controlId} must include source_refs`);
    return;
  }

  if (control.source_refs.some(isRawLegalProfileSourceRef)) {
    issues.push(`${controlId} must not cite raw legal profile rows as direct source_refs`);
  }

  if (!control.source_refs.some((sourceRef) => sourceRef.sourcePath.startsWith("compiled/") || sourceRef.sourcePath.startsWith("wiki/"))) {
    issues.push(`${controlId} must cite compiled OpenKB or wiki sources`);
  }

  if (control.pack?.effective_status === "deleted_residual_risk") {
    if (!control.human_review_required) {
      issues.push(`${controlId} deleted residual-risk controls must require human review`);
    }
    if (!control.required_operating_practices.some((practice) => /residual|deleted/i.test(practice))) {
      issues.push(`${controlId} deleted residual-risk controls must preserve residual-risk operating practice`);
    }
  }
}

function isRawLegalProfileSourceRef(sourceRef: SourceRef): boolean {
  return sourceRef.sourcePath === RAW_LEGAL_PROFILE || sourceRef.sourcePath.startsWith("raw/legal/");
}

async function readJsonFile<T>(root: string, relativePath: string, issues: string[]): Promise<T | undefined> {
  const path = join(root, relativePath);
  try {
    const content = await readFile(path, "utf8");
    for (const forbidden of PUBLIC_PACK_FORBIDDEN_PATTERNS) {
      if (forbidden.pattern.test(content)) {
        issues.push(`${relativePath} contains ${forbidden.label}`);
      }
    }
    return JSON.parse(content) as T;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      issues.push(`${relativePath} is missing`);
      return undefined;
    }
    if (error instanceof SyntaxError) {
      issues.push(`${relativePath} is not valid JSON`);
      return undefined;
    }
    throw error;
  }
}

async function readControls(
  packRoot: string,
  issues: string[]
): Promise<Array<{ path: string; content: string; parsed: ControlKnowledge }>> {
  const controlsRoot = join(packRoot, "controls");
  try {
    if (!(await stat(controlsRoot)).isDirectory()) {
      issues.push("controls/ is not a directory");
      return [];
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      issues.push("controls/ is missing");
      return [];
    }
    throw error;
  }

  const controlFiles = await jsonControlFileNames(controlsRoot);
  if (controlFiles.length === 0) {
    issues.push("controls/ has no JSON control files");
    return [];
  }

  const controls: Array<{ path: string; content: string; parsed: ControlKnowledge }> = [];
  for (const file of controlFiles) {
    const path = join(controlsRoot, file);
    const content = await readFile(path, "utf8");
    try {
      controls.push({ path, content, parsed: JSON.parse(content) as ControlKnowledge });
    } catch (error) {
      if (error instanceof SyntaxError) {
        issues.push(`controls/${file} is not valid JSON`);
        continue;
      }
      throw error;
    }
  }

  return controls;
}

async function jsonControlFileNames(directory: string): Promise<string[]> {
  return (await readdir(directory))
    .filter((name) => name.endsWith(".json"))
    .sort((left, right) => left.localeCompare(right, "en"));
}
