import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { analyzeControls } from "../analyzer/gap.js";
import { renderBacklog } from "../reports/backlog.js";
import { renderControlGapReport } from "../reports/control-gap-report.js";
import { renderEvidenceMap } from "../reports/evidence-map.js";
import type { ControlKnowledge } from "../schemas/control.js";
import type { ScanResult } from "../schemas/scan.js";

export interface ReportResult {
  outputPaths: {
    backlog: string;
    controlGapReport: string;
    evidenceMap: string;
  };
}

export async function generateReports(workspaceRoot: string): Promise<ReportResult> {
  const controls = await loadControls(workspaceRoot);
  const scan = await loadLatestScan(workspaceRoot);
  const analyses = analyzeControls(controls, scan.signals);

  const reportsDir = join(workspaceRoot, "reports");
  await mkdir(reportsDir, { recursive: true });

  const outputPaths = {
    backlog: join(reportsDir, "backlog.md"),
    controlGapReport: join(reportsDir, "control-gap-report.md"),
    evidenceMap: join(reportsDir, "evidence-map.md")
  };

  await writeFile(outputPaths.backlog, renderBacklog(analyses));
  await writeFile(outputPaths.controlGapReport, renderControlGapReport(analyses));
  await writeFile(outputPaths.evidenceMap, renderEvidenceMap(analyses));

  return { outputPaths };
}

async function loadControls(workspaceRoot: string): Promise<ControlKnowledge[]> {
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

async function loadLatestScan(workspaceRoot: string): Promise<ScanResult> {
  const scansDir = join(workspaceRoot, "scans");
  const names = await jsonFileNames(scansDir);
  if (names.length === 0) {
    throw new Error("No scan JSON files found in scans/. Run isms-agent scan before report.");
  }

  const latestName = names.at(-1);
  if (!latestName) {
    throw new Error("No scan JSON files found in scans/. Run isms-agent scan before report.");
  }

  return JSON.parse(await readFile(join(scansDir, latestName), "utf8")) as ScanResult;
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
