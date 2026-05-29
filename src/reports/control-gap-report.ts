import type { ControlAnalysisResult } from "../schemas/analysis.js";
import { markdownList, sourceRefList } from "./markdown.js";

export function renderControlGapReport(analyses: ControlAnalysisResult[]): string {
  const sorted = [...analyses].sort(compareControlResults);
  const sections = sorted.map((result) => [
    `## ${result.control_id} ${result.title}`,
    `**Status:** ${result.status}`,
    `**Confidence:** ${result.confidence}`,
    `**Basis:** ${result.judgment_basis}`,
    isDeletedResidualRisk(result)
      ? "**Pack note:** Deleted residual-risk control. OpenKB marks this control as deleted; review residual obligations before treating it as not applicable."
      : undefined,
    "**Observed candidate evidence:**",
    markdownList(result.observed_evidence, "No candidate evidence observed."),
    "**Missing items:**",
    markdownList(result.missing, "No missing items identified."),
    "**Recommended actions:**",
    markdownList(result.recommended_actions, "No recommended actions generated."),
    evidenceReviewSection(result),
    "**Required candidate evidence:**",
    markdownList(result.required_evidence, "No required evidence recorded."),
    "**Source refs:**",
    sourceRefList(result.source_refs)
  ].filter((line) => line !== undefined).join("\n\n"));

  return [
    "# Control Gap Report",
    "This report uses conservative analyzer judgments. All evidence labels refer to candidate evidence that requires human review before certification use.",
    ...sections
  ].join("\n\n") + "\n";
}

function compareControlResults(left: ControlAnalysisResult, right: ControlAnalysisResult): number {
  return left.control_id.localeCompare(right.control_id, "en");
}

function isDeletedResidualRisk(result: ControlAnalysisResult): boolean {
  return result.pack?.effective_status === "deleted_residual_risk";
}

function evidenceReviewSection(result: ControlAnalysisResult): string | undefined {
  if (!result.evidence_reviews || result.evidence_reviews.length === 0) {
    return undefined;
  }

  return [
    "**Evidence review overlay:**",
    markdownList(result.evidence_reviews.map((review) => {
      const reviewer = review.reviewer ? ` by ${review.reviewer}` : "";
      const expires = review.expires_at ? `; expires ${review.expires_at}` : "";
      const title = review.title ? ` (${review.title})` : "";
      return `${review.requirement_id}: ${review.decision}${reviewer} for ${review.evidence_id}${title}${expires} - ${review.rationale}`;
    }))
  ].join("\n\n");
}
