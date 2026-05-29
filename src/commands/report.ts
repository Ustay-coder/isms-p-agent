import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { analyzeControls } from "../analyzer/gap.js";
import { loadControls, loadEvidenceReviewSummaries, loadLatestScan } from "../core/workspace-data.js";
import { renderBacklog } from "../reports/backlog.js";
import { renderControlGapReport } from "../reports/control-gap-report.js";
import { renderEvidenceMap } from "../reports/evidence-map.js";

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
  const reviewSummaries = await loadEvidenceReviewSummaries(workspaceRoot);
  const analyses = analyzeControls(controls, scan.signals).map((analysis) => ({
    ...analysis,
    evidence_reviews: reviewSummaries.filter((review) => review.requirement_id.startsWith(`${analysis.control_id}.`))
  }));

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
