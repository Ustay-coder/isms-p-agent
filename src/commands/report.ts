import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { analyzeControls } from "../analyzer/gap.js";
import { loadEvidenceIndex } from "./evidence.js";
import { loadControls, loadEvidenceReviewSummaries, loadLatestScan } from "../core/workspace-data.js";
import { renderBacklog } from "../reports/backlog.js";
import { renderControlGapReport } from "../reports/control-gap-report.js";
import { renderEvidenceMap } from "../reports/evidence-map.js";
import type { ControlAnalysisResult, RequirementAnalysisResult } from "../schemas/analysis.js";
import type { ControlKnowledge, ControlRequirement } from "../schemas/control.js";
import type { EvidenceItem, EvidenceReviewSummary } from "../schemas/evidence.js";

export interface ReportResult {
  outputPaths: {
    backlog: string;
    controlGapReport: string;
    evidenceMap: string;
  };
}

export interface ReportOptions {
  public?: boolean;
}

export async function generateReports(workspaceRoot: string, options: ReportOptions = {}): Promise<ReportResult> {
  const controls = await loadControls(workspaceRoot);
  const scan = await loadLatestScan(workspaceRoot);
  const evidence = await loadEvidenceIndex(workspaceRoot);
  const reviewSummaries = await loadEvidenceReviewSummaries(workspaceRoot);
  const analyses = analyzeControls(controls, scan.signals).map((analysis) => {
    const control = controls.find((item) => item.control_id === analysis.control_id);
    const evidenceReviews = reviewSummaries.filter((review) => review.requirement_id.startsWith(`${analysis.control_id}.`));
    return applyRequirementAnalysis(analysis, control, evidence, evidenceReviews, options.public === true);
  }).map((analysis) => options.public ? publicSafeAnalysis(analysis) : analysis);

  const reportsDir = join(workspaceRoot, "reports");
  await mkdir(reportsDir, { recursive: true });

  const outputPaths = {
    backlog: join(reportsDir, options.public ? "public-backlog.md" : "backlog.md"),
    controlGapReport: join(reportsDir, options.public ? "public-control-gap-report.md" : "control-gap-report.md"),
    evidenceMap: join(reportsDir, options.public ? "public-evidence-map.md" : "evidence-map.md")
  };

  await writeFile(outputPaths.backlog, renderBacklog(analyses));
  await writeFile(outputPaths.controlGapReport, renderControlGapReport(analyses, { public: options.public === true }));
  await writeFile(outputPaths.evidenceMap, renderEvidenceMap(analyses, { public: options.public === true }));

  return { outputPaths };
}

function applyRequirementAnalysis(
  analysis: ControlAnalysisResult,
  control: ControlKnowledge | undefined,
  evidence: EvidenceItem[],
  reviews: EvidenceReviewSummary[],
  publicMode: boolean
): ControlAnalysisResult {
  const requirementEvaluations = evaluateRequirements(control?.requirements ?? [], evidence, reviews);
  const safeReviews = publicMode ? publicReviewSummaries(reviews) : reviews;
  const base = {
    ...analysis,
    evidence_reviews: safeReviews,
    requirement_evaluations: requirementEvaluations
  };

  if (requirementEvaluations.length === 0) {
    return base;
  }

  return {
    ...base,
    status: rollupStatus(base.status, requirementEvaluations),
    missing: [
      ...base.missing,
      ...requirementEvaluations
        .filter((requirement) => requirement.required && requirement.status === "missing")
        .map((requirement) => requirement.requirement_id)
    ],
    recommended_actions: [
      ...base.recommended_actions,
      ...requirementEvaluations
        .filter((requirement) => requirement.status !== "met" && requirement.status !== "not_applicable")
        .map((requirement) => requirement.next_action)
    ]
  };
}

function evaluateRequirements(
  requirements: ControlRequirement[],
  evidence: EvidenceItem[],
  reviews: EvidenceReviewSummary[]
): RequirementAnalysisResult[] {
  return requirements.map((requirement) => {
    const matchingReviews = reviews.filter((review) => review.requirement_id === requirement.requirement_id);
    const nonRejectedReviewEvidenceIds = new Set(matchingReviews.filter((review) => review.decision !== "rejected").map((review) => review.evidence_id));
    const matchingEvidence = evidence.filter((item) => item.supports.includes(requirement.requirement_id) || nonRejectedReviewEvidenceIds.has(item.evidence_id));
    const latestReviews = latestReviewByEvidence(matchingReviews);
    const status = requirementStatus(requirement, matchingEvidence, latestReviews);

    return {
      requirement_id: requirement.requirement_id,
      title: requirement.title,
      required: requirement.required,
      status,
      evidence_ids: [...new Set([
        ...matchingEvidence.map((item) => item.evidence_id),
        ...matchingReviews.filter((review) => review.decision !== "rejected").map((review) => review.evidence_id)
      ])].sort((left, right) => left.localeCompare(right, "en")),
      next_action: nextAction(requirement, status)
    };
  });
}

function latestReviewByEvidence(reviews: EvidenceReviewSummary[]): EvidenceReviewSummary[] {
  const byEvidence = new Map<string, EvidenceReviewSummary>();
  for (const review of reviews) {
    byEvidence.set(review.evidence_id, review);
  }
  return [...byEvidence.values()];
}

function requirementStatus(
  requirement: ControlRequirement,
  evidence: EvidenceItem[],
  reviews: EvidenceReviewSummary[]
): RequirementAnalysisResult["status"] {
  if (!requirement.required) {
    return "not_applicable";
  }

  if (reviews.some((review) => review.decision === "needs_followup")) {
    return "needs_followup";
  }

  const acceptedReviews = reviews.filter((review) => review.decision === "accepted");
  const currentAcceptedReviews = acceptedReviews.filter((review) => !review.expires_at || Date.parse(review.expires_at) >= Date.now());
  if (currentAcceptedReviews.length > 0) {
    return "met";
  }
  if (acceptedReviews.length > 0) {
    return "expired";
  }

  if (evidence.length > 0) {
    return "candidate";
  }

  return "missing";
}

function rollupStatus(
  currentStatus: ControlAnalysisResult["status"],
  requirements: RequirementAnalysisResult[]
): ControlAnalysisResult["status"] {
  const required = requirements.filter((requirement) => requirement.required);
  if (required.length === 0) {
    return currentStatus;
  }
  if (required.every((requirement) => requirement.status === "met" || requirement.status === "not_applicable")) {
    return "satisfied";
  }
  if (required.some((requirement) => requirement.status === "missing")) {
    return "partial";
  }
  return "partial";
}

function nextAction(requirement: ControlRequirement, status: RequirementAnalysisResult["status"]): string {
  if (status === "met") {
    return `Keep ${requirement.requirement_id} evidence current.`;
  }
  if (status === "candidate") {
    return `Review candidate evidence for ${requirement.requirement_id}.`;
  }
  if (status === "needs_followup") {
    return `Resolve review follow-up for ${requirement.requirement_id}.`;
  }
  if (status === "expired") {
    return `Refresh expired evidence for ${requirement.requirement_id}.`;
  }
  if (status === "not_applicable") {
    return `Recheck applicability for ${requirement.requirement_id} if scope changes.`;
  }
  return `Collect evidence for ${requirement.requirement_id}.`;
}

function publicReviewSummaries(reviews: EvidenceReviewSummary[]): EvidenceReviewSummary[] {
  return reviews.map((review) => ({
    evidence_id: review.evidence_id,
    requirement_id: review.requirement_id,
    decision: review.decision,
    rationale: "Private review rationale omitted from public report.",
    ...(review.expires_at ? { expires_at: review.expires_at } : {}),
    ...(review.classification ? { classification: review.classification } : {})
  }));
}

function publicSafeAnalysis(analysis: ControlAnalysisResult): ControlAnalysisResult {
  return {
    ...analysis,
    observed_evidence: analysis.observed_evidence.map(sanitizePublicText),
    missing: analysis.missing.map(sanitizePublicText),
    recommended_actions: analysis.recommended_actions.map(sanitizePublicText),
    required_evidence: analysis.required_evidence.map(sanitizePublicText),
    evidence_reviews: analysis.evidence_reviews?.map((review) => ({
      ...review,
      title: undefined,
      rationale: "Private review rationale omitted from public report."
    }))
  };
}

function sanitizePublicText(value: string): string {
  return value
    .replace(/(?:^|\s)(?:evidence\/private|reviews|scans|reports)\/[^\s),;]+/g, " [private-detail-omitted]")
    .replace(/\/[^\s),;]*(?:evidence\/private|reviews|scans|reports)\/[^\s),;]+/g, "[private-detail-omitted]");
}
