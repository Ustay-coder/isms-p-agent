export type EvidenceType =
  | "policy_document"
  | "procedure_document"
  | "configuration_export"
  | "access_review_record"
  | "change_approval_record"
  | "audit_log"
  | "implementation_file"
  | "test_result"
  | "connector_snapshot"
  | "applicability_note";

export type EvidenceClassification =
  | "public_sample"
  | "internal"
  | "confidential"
  | "secret"
  | "personal_data";

export type EvidenceLifecycleStatus =
  | "candidate"
  | "needs_review"
  | "accepted"
  | "rejected"
  | "expired"
  | "superseded";

export type EvidenceOrigin = "scan" | "connector" | "manual" | "redacted_sample";

export interface EvidenceLocator {
  kind: "workspace_path" | "external_reference" | "scan_signal" | "connector_snapshot";
  value: string;
}

export interface EvidenceItem {
  evidence_id: string;
  title: string;
  evidence_type: EvidenceType;
  classification: EvidenceClassification;
  lifecycle_status: EvidenceLifecycleStatus;
  origin: EvidenceOrigin;
  supports: string[];
  locator: EvidenceLocator;
  summary: string;
  content_sha256?: string;
  collected_at: string;
  valid_until?: string;
  review_required: boolean;
  metadata: Record<string, string | number | boolean | string[]>;
}

export type ReviewDecision = "accepted" | "rejected" | "needs_followup";

export interface EvidenceReviewRecord {
  schemaVersion: 1;
  reviewed_at: string;
  evidence_id: string;
  requirement_id: string;
  decision: ReviewDecision;
  reviewer?: string;
  rationale: string;
  private_evidence_path?: string;
  conditions?: string[];
  expires_at?: string;
  replacement_evidence_id?: string;
}

export interface EvidenceReviewSummary {
  evidence_id: string;
  requirement_id: string;
  decision: ReviewDecision;
  rationale: string;
  reviewer?: string;
  expires_at?: string;
  classification?: EvidenceClassification;
  title?: string;
}
