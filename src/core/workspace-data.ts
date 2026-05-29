import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { loadEvidenceIndex, loadEvidenceReviews } from "../commands/evidence.js";
import type { ControlKnowledge } from "../schemas/control.js";
import type { EvidenceReviewRecord, EvidenceReviewSummary } from "../schemas/evidence.js";
import type { ScanResult } from "../schemas/scan.js";

export async function loadControls(workspaceRoot: string): Promise<ControlKnowledge[]> {
  const controlsDir = join(workspaceRoot, "controls");
  const names = await jsonFileNames(controlsDir);
  if (names.length === 0) {
    throw new Error("No control JSON files found in controls/. Run isms-agent ingest before report.");
  }

  const controls = [];
  for (const name of names) {
    controls.push(JSON.parse(await readFile(join(controlsDir, name), "utf8")) as ControlKnowledge);
  }

  return controls.sort((left, right) => left.control_id.localeCompare(right.control_id, "en"));
}

export async function loadLatestScan(workspaceRoot: string): Promise<ScanResult> {
  const scansDir = join(workspaceRoot, "scans");
  const names = await jsonFileNames(scansDir);
  if (names.length === 0) {
    throw new Error("No scan JSON files found in scans/. Run isms-agent scan before report.");
  }

  const scanFiles = [];
  for (const name of names) {
    const path = join(scansDir, name);
    const content = await readFile(path, "utf8");
    const scan = JSON.parse(content) as ScanResult;
    const generatedAtMs = Date.parse(scan.generatedAt);
    const fallbackMtimeMs = (await stat(path)).mtimeMs;
    scanFiles.push({
      name,
      scan,
      sortTimeMs: Number.isFinite(generatedAtMs) ? generatedAtMs : fallbackMtimeMs
    });
  }

  scanFiles.sort((left, right) => {
    const timeComparison = left.sortTimeMs - right.sortTimeMs;
    return timeComparison === 0 ? left.name.localeCompare(right.name, "en") : timeComparison;
  });

  const latest = scanFiles.at(-1);
  if (!latest) {
    throw new Error("No scan JSON files found in scans/. Run isms-agent scan before report.");
  }

  return latest.scan;
}

export async function loadEvidenceReviewSummaries(workspaceRoot: string): Promise<EvidenceReviewSummary[]> {
  const evidence = await loadEvidenceIndex(workspaceRoot);
  const evidenceById = new Map(evidence.map((item) => [item.evidence_id, item]));
  const reviews = await loadEvidenceReviews(workspaceRoot);
  const latestByKey = new Map<string, EvidenceReviewRecord>();

  for (const review of reviews) {
    const key = `${review.evidence_id}\0${review.requirement_id}`;
    const current = latestByKey.get(key);
    if (!current || Date.parse(current.reviewed_at) <= Date.parse(review.reviewed_at)) {
      latestByKey.set(key, review);
    }
  }

  return [...latestByKey.values()]
    .sort((left, right) => {
      const requirementComparison = left.requirement_id.localeCompare(right.requirement_id, "en");
      return requirementComparison === 0 ? left.evidence_id.localeCompare(right.evidence_id, "en") : requirementComparison;
    })
    .map((review) => {
      const item = evidenceById.get(review.evidence_id);
      return {
        evidence_id: review.evidence_id,
        requirement_id: review.requirement_id,
        decision: review.decision,
        rationale: review.rationale,
        reviewer: review.reviewer,
        expires_at: review.expires_at,
        classification: item?.classification,
        title: item?.title
      };
    });
}

async function jsonFileNames(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory))
      .filter((name) => name.endsWith(".json"))
      .sort((left, right) => left.localeCompare(right, "en"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
