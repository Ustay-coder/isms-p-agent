import type { ControlAnalysisResult } from "../schemas/analysis.js";
import { markdownList, sourceRefList } from "./markdown.js";

export function renderControlGapReport(analyses: ControlAnalysisResult[]): string {
  const sorted = [...analyses].sort(compareControlResults);
  const sections = sorted.map((result) => [
    `## ${result.control_id} ${result.title}`,
    `**Status:** ${result.status}`,
    `**Confidence:** ${result.confidence}`,
    `**Basis:** ${result.judgment_basis}`,
    "**Observed candidate evidence:**",
    markdownList(result.observed_evidence, "No candidate evidence observed."),
    "**Missing items:**",
    markdownList(result.missing, "No missing items identified."),
    "**Recommended actions:**",
    markdownList(result.recommended_actions, "No recommended actions generated."),
    "**Required candidate evidence:**",
    markdownList(result.required_evidence, "No required evidence recorded."),
    "**Source refs:**",
    sourceRefList(result.source_refs)
  ].join("\n\n"));

  return [
    "# Control Gap Report",
    "This report uses conservative analyzer judgments. All evidence labels refer to candidate evidence that requires human review before certification use.",
    ...sections
  ].join("\n\n") + "\n";
}

function compareControlResults(left: ControlAnalysisResult, right: ControlAnalysisResult): number {
  return left.control_id.localeCompare(right.control_id, "en");
}
