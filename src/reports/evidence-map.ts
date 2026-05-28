import type { ControlAnalysisResult } from "../schemas/analysis.js";
import { markdownTable } from "./markdown.js";

export function renderEvidenceMap(analyses: ControlAnalysisResult[]): string {
  const rows = [...analyses].sort(compareControlResults).flatMap((result) => {
    const candidateEvidence = result.required_evidence.length > 0 ? result.required_evidence : ["Control owner-defined candidate evidence"];
    return candidateEvidence.map((evidence) => [
      `${result.control_id} ${result.title}`,
      evidence,
      whereEvidenceMightComeFrom(result),
      result.observed_evidence.length > 0 && result.status !== "needs_confirmation" ? "candidate exists" : "not confirmed",
      operationCoverage(result),
      humanReviewNeeded(result)
    ]);
  });

  return [
    "# Evidence Map",
    "This map lists candidate evidence only. Human review is required before certification use.",
    markdownTable([
      "Which control it supports",
      "Candidate evidence",
      "Where the evidence might come from",
      "Whether it already exists",
      "Operation or configuration",
      "Human review needed"
    ], rows)
  ].join("\n\n") + "\n";
}

function whereEvidenceMightComeFrom(result: ControlAnalysisResult): string {
  if (result.observed_evidence.length > 0) {
    return result.observed_evidence.join("; ");
  }

  if (result.status === "needs_confirmation") {
    return "scanner output, applicability answers, or operating documents requiring confirmation";
  }

  return "operating documents, platform exports, repository configuration, or control owner records";
}

function operationCoverage(result: ControlAnalysisResult): string {
  if (result.status === "satisfied" && result.judgment_basis === "document-backed") {
    return "operation indicated by document-backed candidate evidence";
  }

  if (result.status === "needs_confirmation") {
    return "not confirmed; gather inputs before judging operation";
  }

  if (result.judgment_basis === "observed") {
    return "configuration only";
  }

  return "operation not proven";
}

function humanReviewNeeded(result: ControlAnalysisResult): string {
  if (result.status === "needs_confirmation") {
    return "Confirm applicability, scanner coverage, and missing inputs.";
  }

  if (result.status === "satisfied") {
    return "Review whether candidate evidence is current and acceptable.";
  }

  return "Review missing items, approve operating practice, and validate candidate evidence.";
}

function compareControlResults(left: ControlAnalysisResult, right: ControlAnalysisResult): number {
  return left.control_id.localeCompare(right.control_id, "en");
}
