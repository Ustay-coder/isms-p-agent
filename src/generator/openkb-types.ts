export interface AnnexMappingRow {
  control_id: string;
  control_name: string;
  part: string;
  domain_id: string;
  status: "유지" | "삭제" | string;
  simplified_control_id: string | null;
  merged_into: string | null;
  source_pages: number[];
}

export interface SourceClaimRow {
  claim_id: string;
  control_id: string;
  control_name: string;
  effective_status?: "유지" | "삭제" | string;
  confidence: "ocr_derived" | "official_verified" | "human_curated" | string;
  review_status: "needs_human_review" | "reviewed" | string;
  source_path: string;
  pages: number[];
}

export interface EvidenceRequirementRow {
  evidence_id: string;
  control_id: string;
  control_name: string;
  domain_name: string;
  title: string;
  evidence_type: string;
  automation_candidate: boolean;
  acceptance_criteria: string;
  refresh_cycle?: string;
}

export interface RawLegalRow {
  control_id: string;
  source_control_id?: string;
  control_name: string;
}

export interface GeneratePackOptions {
  openkbRoot: string;
  packRoot: string;
  packName: string;
  version: string;
  controlIds: string[];
}

export interface GeneratePackResult {
  packRoot: string;
  generatedControls: string[];
}
