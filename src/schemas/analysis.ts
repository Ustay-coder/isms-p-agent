import type { SourceRef } from "./control.js";

export type ControlStatus = "satisfied" | "partial" | "gap" | "not_applicable" | "needs_confirmation";

export type Confidence = "low" | "medium" | "high";

export type JudgmentBasis = "observed" | "document-backed" | "inferred" | "user-confirmed";

export interface ControlAnalysisResult {
  control_id: string;
  title: string;
  status: ControlStatus;
  observed_evidence: string[];
  missing: string[];
  recommended_actions: string[];
  required_evidence: string[];
  confidence: Confidence;
  judgment_basis: JudgmentBasis;
  source_refs: SourceRef[];
}
