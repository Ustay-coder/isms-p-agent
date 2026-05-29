import type { ControlAnalysisResult } from "../schemas/analysis.js";
import { markdownTable } from "./markdown.js";
import type { ReportRenderOptions } from "./control-gap-report.js";

export function renderEvidenceMap(analyses: ControlAnalysisResult[], options: ReportRenderOptions = {}): string {
  const rows = [...analyses].sort(compareControlResults).flatMap((result) => {
    if (isDeletedResidualRisk(result)) {
      return [[
        `${result.control_id} ${result.title}`,
        "Deleted control residual-risk review",
        "OpenKB source mapping, applicability note, residual risk review record",
        "not confirmed",
        "not a normal active-control gap",
        "Confirm residual legal, contractual, or surviving-control obligations."
      ]];
    }

    if (result.status === "not_applicable") {
      return [[
        `${result.control_id} ${result.title}`,
        "Not applicable",
        notApplicableBasis(result),
        "not applicable",
        "not applicable",
        "Review applicability rationale if scope changes."
      ]];
    }

    const candidateEvidence = result.required_evidence.length > 0 ? result.required_evidence : ["Control owner-defined candidate evidence"];
    const evidenceRows = candidateEvidence.map((evidence) => [
      `${result.control_id} ${result.title}`,
      evidence,
      whereEvidenceMightComeFrom(result),
      result.observed_evidence.length > 0 && result.status !== "needs_confirmation" ? "candidate exists" : "not confirmed",
      operationCoverage(result),
      humanReviewNeeded(result)
    ]);

    const requirementRows = (result.requirement_evaluations ?? []).map((requirement) => [
      `${result.control_id} ${result.title}`,
      `Requirement status: ${requirement.requirement_id}`,
      requirement.evidence_ids.length > 0 ? requirement.evidence_ids.join(", ") : "no indexed evidence",
      requirement.status,
      requirement.required ? "required" : "optional",
      requirement.next_action
    ]);

    const reviewRows = (result.evidence_reviews ?? []).map((review) => [
      `${result.control_id} ${result.title}`,
      `Review overlay decision: ${review.requirement_id}`,
      `${review.evidence_id}${review.title ? ` (${review.title})` : ""}`,
      review.decision,
      review.classification ? `classification: ${review.classification}` : "classification not indexed",
      review.rationale
    ]);

    return [...evidenceRows, ...requirementRows, ...reviewRows];
  });

  return [
    "# Evidence Map",
    options.public
      ? "Public-safe evidence map. Private paths, connector payloads, and review rationale are omitted."
      : "This map lists candidate evidence only. Human review is required before certification use.",
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

function notApplicableBasis(result: ControlAnalysisResult): string {
  return result.observed_evidence.length > 0 ? result.observed_evidence.join("; ") : "Applicability review marked this control not applicable";
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

function isDeletedResidualRisk(result: ControlAnalysisResult): boolean {
  return result.pack?.effective_status === "deleted_residual_risk";
}
