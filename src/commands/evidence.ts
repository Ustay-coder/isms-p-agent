import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type { EvidenceItem, EvidenceReviewRecord, ReviewDecision } from "../schemas/evidence.js";
import type { ScanResult, ScanSignal } from "../schemas/scan.js";

const execFileAsync = promisify(execFile);

const PRIVATE_TRACKED_PREFIXES = [
  "evidence/private/",
  "reviews/",
  "scans/",
  "reports/"
];

const UNSAFE_PUBLIC_CLASSIFICATIONS = new Set(["secret", "personal_data"]);
const PUBLIC_EXPORT_CLASSIFICATIONS = new Set(["public_sample"]);

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

export interface EvidenceIndexOptions {
  fromScan?: string;
}

export interface EvidenceIndexResult {
  outputPath: string;
  scanPath: string;
  indexedEvidence: number;
  signalCount: number;
}

export interface EvidenceReviewOptions {
  evidenceId: string;
  requirementId: string;
  decision: ReviewDecision;
  rationale: string;
  reviewer?: string;
  expiresAt?: string;
  reviewedAt?: Date;
}

export interface EvidenceReviewResult {
  outputPath: string;
  record: EvidenceReviewRecord;
}

export const CLOUDFLARE_BULK_ACCEPTED_ERROR = "Cloudflare bulk review cannot auto-accept scanner evidence. Use evidence review <evidence-id> for a manual accepted decision.";
export const DEFAULT_CLOUDFLARE_REVIEW_RATIONALE = "Cloudflare configuration was observed by a read-only connector, but operating evidence is still required before this requirement can be treated as satisfied.";

export interface CloudflareEvidenceReviewOptions {
  decision?: ReviewDecision;
  rationale?: string;
  reviewer?: string;
  dryRun?: boolean;
  reviewedAt?: Date;
}

export interface CloudflareEvidenceReviewResult {
  outputPath?: string;
  reviewedEvidence: number;
  reviewRecords: number;
  skippedEvidence: number;
  decision: "needs_followup" | "rejected";
  preview: CloudflareEvidenceReviewPreview[];
  records: EvidenceReviewRecord[];
  skipped: Array<{ evidence_id: string; reason: string }>;
}

export interface CloudflareEvidenceReviewPreview {
  evidence_id: string;
  title?: string;
  summary?: string;
  requirement_ids?: string[];
  decision: "needs_followup" | "rejected";
  eligible: boolean;
  skip_reason?: string;
}

export interface PublicEvidenceExportResult {
  outputPath: string;
  exportedEvidence: number;
  omittedEvidence: number;
}

export async function indexEvidenceFromScan(
  workspaceRoot: string,
  options: EvidenceIndexOptions = {}
): Promise<EvidenceIndexResult> {
  const scanPath = options.fromScan
    ? resolveWorkspacePath(workspaceRoot, options.fromScan, "Scan path")
    : await latestScanPath(workspaceRoot);
  const scan = JSON.parse(await readFile(scanPath, "utf8")) as ScanResult;
  const existingEvidence = await loadEvidenceIndex(workspaceRoot);
  const nonScanEvidence = existingEvidence.filter((item) => item.origin !== "scan");
  const evidence = [...nonScanEvidence, ...scan.signals.map((signal) => evidenceFromSignal(signal, scan.generatedAt))];
  evidence.sort((left, right) => left.evidence_id.localeCompare(right.evidence_id, "en"));

  const outputPath = join(workspaceRoot, "evidence", "index.jsonl");
  await mkdir(join(workspaceRoot, "evidence"), { recursive: true });
  await writeFile(outputPath, evidence.map((item) => JSON.stringify(item)).join("\n") + (evidence.length > 0 ? "\n" : ""));

  return {
    outputPath,
    scanPath,
    indexedEvidence: evidence.length,
    signalCount: scan.signals.length
  };
}

export async function reviewEvidence(
  workspaceRoot: string,
  options: EvidenceReviewOptions
): Promise<EvidenceReviewResult> {
  const evidence = await loadEvidenceIndex(workspaceRoot);
  if (!evidence.some((item) => item.evidence_id === options.evidenceId)) {
    throw new Error(`Evidence id not found in evidence/index.jsonl: ${options.evidenceId}`);
  }

  if (!options.requirementId.trim()) {
    throw new Error("Evidence review requires --requirement.");
  }
  if (!options.rationale.trim()) {
    throw new Error("Evidence review requires --rationale.");
  }

  const record: EvidenceReviewRecord = {
    schemaVersion: 1,
    reviewed_at: (options.reviewedAt ?? new Date()).toISOString(),
    evidence_id: options.evidenceId,
    requirement_id: options.requirementId,
    decision: options.decision,
    ...(options.reviewer ? { reviewer: options.reviewer } : {}),
    rationale: options.rationale,
    ...(options.expiresAt ? { expires_at: options.expiresAt } : {})
  };

  const outputPath = join(workspaceRoot, "reviews", "evidence-review.jsonl");
  await mkdir(join(workspaceRoot, "reviews"), { recursive: true });
  await appendFile(outputPath, JSON.stringify(record) + "\n");
  return { outputPath, record };
}

export async function reviewCloudflareEvidence(
  workspaceRoot: string,
  options: CloudflareEvidenceReviewOptions = {}
): Promise<CloudflareEvidenceReviewResult> {
  const requestedDecision = options.decision ?? "needs_followup";
  if (requestedDecision === "accepted") {
    throw new Error(CLOUDFLARE_BULK_ACCEPTED_ERROR);
  }

  const decision: "needs_followup" | "rejected" = requestedDecision;
  const rationale = options.rationale ?? DEFAULT_CLOUDFLARE_REVIEW_RATIONALE;
  if (decision === "rejected" && !rationale.trim()) {
    throw new Error("Cloudflare rejected bulk review requires --rationale.");
  }
  if (!rationale.trim()) {
    throw new Error("Cloudflare bulk review requires a non-empty rationale.");
  }

  const evidence = await loadEvidenceIndex(workspaceRoot);
  const latestReviews = await latestReviewByKey(workspaceRoot);
  const records: EvidenceReviewRecord[] = [];
  const skipped: Array<{ evidence_id: string; reason: string }> = [];
  const preview: CloudflareEvidenceReviewPreview[] = [];
  const reviewedEvidenceIds = new Set<string>();
  const reviewedAt = (options.reviewedAt ?? new Date()).toISOString();

  for (const item of evidence) {
    const skipReason = cloudflareReviewSkipReason(item);
    const isCloudflareEvidence = item.metadata.signal_source === "cloudflare";
    preview.push({
      evidence_id: item.evidence_id,
      ...(isCloudflareEvidence ? { title: item.title, summary: item.summary, requirement_ids: item.supports } : {}),
      decision,
      eligible: !skipReason,
      ...(skipReason ? { skip_reason: skipReason } : {})
    });

    if (skipReason) {
      skipped.push({ evidence_id: item.evidence_id, reason: skipReason });
      continue;
    }

    for (const requirementId of item.supports) {
      const reviewKey = `${item.evidence_id}\0${requirementId}`;
      const latestReview = latestReviews.get(reviewKey);
      if (latestReview?.decision === "accepted") {
        skipped.push({
          evidence_id: item.evidence_id,
          reason: `existing accepted review decision for ${requirementId}`
        });
        continue;
      }
      if (latestReview && latestReview.decision === decision && latestReview.rationale.trim() === rationale.trim()) {
        skipped.push({
          evidence_id: item.evidence_id,
          reason: `existing unchanged ${decision} review decision for ${requirementId}`
        });
        continue;
      }

      reviewedEvidenceIds.add(item.evidence_id);
      records.push({
        schemaVersion: 1,
        reviewed_at: reviewedAt,
        evidence_id: item.evidence_id,
        requirement_id: requirementId,
        decision,
        ...(options.reviewer ? { reviewer: options.reviewer } : {}),
        rationale: rationale.trim()
      });
    }
  }

  const outputPath = join(workspaceRoot, "reviews", "evidence-review.jsonl");
  if (!options.dryRun && records.length > 0) {
    await mkdir(join(workspaceRoot, "reviews"), { recursive: true });
    await appendFile(outputPath, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
  }

  return {
    ...(options.dryRun || records.length === 0 ? {} : { outputPath }),
    reviewedEvidence: reviewedEvidenceIds.size,
    reviewRecords: records.length,
    skippedEvidence: skipped.length,
    decision,
    preview,
    records,
    skipped
  };
}

export async function exportPublicEvidence(workspaceRoot: string): Promise<PublicEvidenceExportResult> {
  const evidence = await loadEvidenceIndex(workspaceRoot);
  const safeEvidence = evidence
    .filter((item) => PUBLIC_EXPORT_CLASSIFICATIONS.has(item.classification))
    .map((item) => ({
      evidence_id: item.evidence_id,
      title: sanitizePublicText(item.title),
      evidence_type: item.evidence_type,
      classification: item.classification,
      lifecycle_status: item.lifecycle_status,
      origin: item.origin,
      supports: item.supports,
      summary: sanitizePublicText(item.summary),
      collected_at: item.collected_at,
      review_required: item.review_required
    }))
    .sort((left, right) => left.evidence_id.localeCompare(right.evidence_id, "en"));

  const outputPath = join(workspaceRoot, "evidence", "redacted", "public-evidence-index.jsonl");
  await mkdir(join(workspaceRoot, "evidence", "redacted"), { recursive: true });
  await writeFile(outputPath, safeEvidence.map((item) => JSON.stringify(item)).join("\n") + (safeEvidence.length > 0 ? "\n" : ""));

  return {
    outputPath,
    exportedEvidence: safeEvidence.length,
    omittedEvidence: evidence.length - safeEvidence.length
  };
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
  const reviews = await loadEvidenceReviews(workspaceRoot);
  const reviewKeys = new Set(reviews.map((review) => `${review.evidence_id}\0${review.requirement_id}`));
  const reviewRequirementsByEvidence = new Map<string, Set<string>>();
  for (const review of reviews) {
    const requirements = reviewRequirementsByEvidence.get(review.evidence_id) ?? new Set<string>();
    requirements.add(review.requirement_id);
    reviewRequirementsByEvidence.set(review.evidence_id, requirements);
  }
  for (const item of evidence) {
    validateEvidenceItem(item, workspaceRoot, publicMode, reviewKeys, reviewRequirementsByEvidence, issues, warnings);
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
  reviewKeys: Set<string>,
  reviewRequirementsByEvidence: Map<string, Set<string>>,
  issues: string[],
  warnings: string[]
): void {
  if (item.supports.length === 0 && !reviewRequirementsByEvidence.has(item.evidence_id)) {
    warnings.push(`evidence ${item.evidence_id} has no requirement mapping.`);
  }

  if (item.lifecycle_status === "accepted" && item.valid_until && Date.parse(item.valid_until) < Date.now()) {
    warnings.push(`accepted evidence ${item.evidence_id} is expired as of ${item.valid_until}.`);
  }

  if ((item.lifecycle_status === "candidate" || item.lifecycle_status === "needs_review") && item.supports.length > 0) {
    const unreviewed = item.supports.filter((requirementId) => !reviewKeys.has(`${item.evidence_id}\0${requirementId}`));
    if (unreviewed.length > 0) {
      warnings.push(`evidence ${item.evidence_id} has candidate requirement mapping but no review decision: ${unreviewed.join(", ")}`);
    }
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

function cloudflareReviewSkipReason(item: EvidenceItem): string | undefined {
  if (item.metadata.signal_source !== "cloudflare") {
    return "not Cloudflare scanner evidence";
  }
  if (item.origin !== "scan") {
    return "not scan-origin evidence";
  }
  if (item.lifecycle_status !== "candidate") {
    return "not candidate evidence";
  }
  if (item.classification !== "confidential" && item.classification !== "internal") {
    return "classification is not eligible for Cloudflare bulk review";
  }
  if (item.supports.length === 0) {
    return "no requirement mapping";
  }
  return undefined;
}

async function latestReviewByKey(workspaceRoot: string): Promise<Map<string, EvidenceReviewRecord>> {
  const latestByKey = new Map<string, EvidenceReviewRecord>();
  for (const review of await loadEvidenceReviews(workspaceRoot)) {
    const key = `${review.evidence_id}\0${review.requirement_id}`;
    const current = latestByKey.get(key);
    if (!current || Date.parse(current.reviewed_at) <= Date.parse(review.reviewed_at)) {
      latestByKey.set(key, review);
    }
  }
  return latestByKey;
}

export async function loadEvidenceIndex(workspaceRoot: string): Promise<EvidenceItem[]> {
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

export async function loadEvidenceReviews(workspaceRoot: string): Promise<EvidenceReviewRecord[]> {
  const path = join(workspaceRoot, "reviews", "evidence-review.jsonl");
  try {
    return parseJsonl<EvidenceReviewRecord>(await readFile(path, "utf8"), path);
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

function sanitizePublicText(value: string): string {
  return value
    .replace(/(?:^|\s)(?:evidence\/private|reviews|scans|reports)\/[^\s),;]+/g, " [private-detail-omitted]")
    .replace(/\/[^\s),;]*(?:evidence\/private|reviews|scans|reports)\/[^\s),;]+/g, "[private-detail-omitted]");
}

function credentialLikeMetadataPath(metadata: Record<string, string | number | boolean | string[]>): string | undefined {
  for (const [key, value] of Object.entries(metadata)) {
    const loweredKey = key.toLowerCase();
    if (/(secret|token|password|private.?key|credential|database.?url|api.?key)/i.test(loweredKey)) {
      return key;
    }
    if (isKnownSafeMetadataValue(key, value)) {
      continue;
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

function isKnownSafeMetadataValue(key: string, value: string | number | boolean | string[]): boolean {
  if (key !== "permission_status" || typeof value !== "string") {
    return false;
  }
  return [
    "available",
    "missing_token",
    "missing_account_id",
    "needs_permission_or_confirmation",
    "zone_unavailable",
    "not_observed"
  ].includes(value);
}

function looksLikeSecret(value: string): boolean {
  return /(sk_live|sk_test|ghp_|github_pat_|xox[baprs]-|AKIA|-----BEGIN [A-Z ]+PRIVATE KEY-----)/.test(value)
    || /[A-Za-z0-9_=-]{32,}/.test(value);
}

async function latestScanPath(workspaceRoot: string): Promise<string> {
  const scansDir = join(workspaceRoot, "scans");
  let names: string[];
  try {
    names = (await readdir(scansDir)).filter((name) => name.endsWith(".json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("No scan JSON files found in scans/. Run isms-agent scan before evidence index.");
    }
    throw error;
  }
  if (names.length === 0) {
    throw new Error("No scan JSON files found in scans/. Run isms-agent scan before evidence index.");
  }

  const candidates = [];
  for (const name of names) {
    const path = join(scansDir, name);
    const scan = JSON.parse(await readFile(path, "utf8")) as ScanResult;
    const generatedAtMs = Date.parse(scan.generatedAt);
    const fallbackMtimeMs = (await stat(path)).mtimeMs;
    candidates.push({
      path,
      name,
      sortTimeMs: Number.isFinite(generatedAtMs) ? generatedAtMs : fallbackMtimeMs
    });
  }

  candidates.sort((left, right) => {
    const timeComparison = left.sortTimeMs - right.sortTimeMs;
    return timeComparison === 0 ? left.name.localeCompare(right.name, "en") : timeComparison;
  });

  return candidates.at(-1)?.path ?? "";
}

function resolveWorkspacePath(workspaceRoot: string, inputPath: string, label: string): string {
  const workspace = resolve(workspaceRoot);
  const resolved = resolve(workspace, inputPath);
  const relativePath = relative(workspace, resolved);
  if (relativePath === ".." || relativePath.startsWith("../") || isAbsolute(relativePath)) {
    throw new Error(`${label} must be inside the workspace: ${inputPath}`);
  }
  return resolved;
}

function evidenceFromSignal(signal: ScanSignal, collectedAt: string): EvidenceItem {
  return {
    evidence_id: scanEvidenceId(signal),
    title: `${sourceLabel(signal.source)} candidate: ${signal.summary}`,
    evidence_type: evidenceTypeForSignal(signal),
    classification: signal.source === "cloudflare" || signal.source === "github" || signal.source === "vercel" ? "confidential" : "internal",
    lifecycle_status: "candidate",
    origin: "scan",
    supports: requirementIdsFromSignal(signal),
    locator: {
      kind: "scan_signal",
      value: signal.id
    },
    summary: signal.summary,
    content_sha256: sha256(JSON.stringify(signal)),
    collected_at: collectedAt,
    review_required: true,
    metadata: {
      signal_id: signal.id,
      signal_source: signal.source,
      signal_basis: signal.basis,
      path_count: signal.paths.length,
      ...safeSignalMetadata(signal.metadata)
    }
  };
}

function safeSignalMetadata(metadata: ScanSignal["metadata"]): Record<string, string | number | boolean | string[]> {
  const safe: Record<string, string | number | boolean | string[]> = {};
  for (const key of ["product", "permission_status", "snapshot_id", "sensitivity", "count", "available", "requirement_ids"] as const) {
    const value = metadata[key];
    if (isSafeMetadataValue(value)) {
      safe[key] = value;
    }
  }

  const endpoint = metadata.endpoint;
  if (typeof endpoint === "string" && isTemplatedEndpoint(endpoint)) {
    safe.endpoint = endpoint;
  }

  return safe;
}

function isSafeMetadataValue(value: string | number | boolean | string[] | undefined): value is string | number | boolean | string[] {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" || Array.isArray(value);
}

function isTemplatedEndpoint(value: string): boolean {
  return value.startsWith("/") && !/\/accounts\/[^/{]/.test(value) && !/\/zones\/[^/{]/.test(value);
}

function scanEvidenceId(signal: ScanSignal): string {
  const base = `ev_scan_${slug(signal.source)}_${slug(signal.id)}`;
  return base.length <= 96 ? base : `${base.slice(0, 84)}_${sha256(base).slice(0, 10)}`;
}

function requirementIdsFromSignal(signal: ScanSignal): string[] {
  const values = [
    metadataStrings(signal.metadata.requirement_id),
    metadataStrings(signal.metadata.requirement_ids),
    metadataStrings(signal.metadata.supports)
  ].flat();
  return [...new Set(values.filter((value) => value.startsWith("ISMS-P-")).sort((left, right) => left.localeCompare(right, "en")))];
}

function metadataStrings(value: string | number | boolean | string[] | undefined): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  return typeof value === "string" ? [value] : [];
}

function evidenceTypeForSignal(signal: ScanSignal): EvidenceItem["evidence_type"] {
  if (signal.source === "local-repo") {
    return "implementation_file";
  }
  if (signal.source === "local-docs") {
    return "procedure_document";
  }
  return "connector_snapshot";
}

function sourceLabel(source: ScanSignal["source"]): string {
  if (source === "local-docs") {
    return "Local docs";
  }
  if (source === "local-repo") {
    return "Local repo";
  }
  return source[0]?.toUpperCase() + source.slice(1);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "signal";
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
