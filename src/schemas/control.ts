export type AutomationPotential = "none" | "partial" | "high";

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
}
