export type AutomationPotential = "none" | "partial" | "high";

export type PackEffectiveStatus = "active" | "deleted_residual_risk";
export type PackReviewStatus = "needs_human_review" | "reviewed";
export type PackSourceConfidence = "ocr_derived" | "official_verified" | "human_curated";

export interface ControlPackMetadata {
  name: string;
  source_of_truth: "openkb";
  openkb_control_id: string;
  effective_status: PackEffectiveStatus;
  review_status: PackReviewStatus;
  source_confidence: PackSourceConfidence;
}

export interface SourceRef {
  sourcePath: string;
  sha256: string;
  excerpt?: string;
}

export interface ControlKnowledge {
  control_id: string;
  title: string;
  domain: string;
  category: string;
  requirement: string;
  intent: string;
  applicability_questions: string[];
  observable_signals: string[];
  required_operating_practices: string[];
  required_evidence: string[];
  common_defects: string[];
  automation_potential: AutomationPotential;
  human_review_required: boolean;
  source_refs: SourceRef[];
  pack?: ControlPackMetadata;
}
