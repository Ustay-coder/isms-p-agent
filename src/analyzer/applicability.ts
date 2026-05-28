import type { ControlKnowledge } from "../schemas/control.js";
import type { JudgmentBasis } from "../schemas/analysis.js";
import type { ScanSignal } from "../schemas/scan.js";

export interface ApplicabilityAnswer {
  applicable: boolean;
  basis: JudgmentBasis;
  reason: string;
}

export type ApplicabilityAnswers = Record<string, ApplicabilityAnswer>;

export interface ApplicabilityDecision {
  applicable: boolean | "unknown";
  reason?: string;
  basis?: JudgmentBasis;
}

export function assessApplicability(
  control: ControlKnowledge,
  _signals: ScanSignal[],
  applicabilityAnswers: ApplicabilityAnswers = {}
): ApplicabilityDecision {
  const answer = applicabilityAnswers[control.control_id];
  if (answer) {
    return {
      applicable: answer.applicable,
      reason: answer.reason,
      basis: answer.basis
    };
  }

  return { applicable: "unknown" };
}
