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

const STOP_WORDS = new Set([
  "a",
  "an",
  "are",
  "do",
  "does",
  "for",
  "have",
  "is",
  "of",
  "or",
  "the",
  "to",
  "use",
  "you",
  "your"
]);

export function assessApplicability(
  control: ControlKnowledge,
  signals: ScanSignal[],
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

  const unsupported = findUnsupportedApplicabilitySignal(control, signals);
  if (unsupported) {
    return {
      applicable: false,
      reason: unsupported.summary,
      basis: signalBasisToJudgmentBasis(unsupported.basis)
    };
  }

  return { applicable: "unknown" };
}

function findUnsupportedApplicabilitySignal(control: ControlKnowledge, signals: ScanSignal[]): ScanSignal | undefined {
  const terms = control.applicability_questions.flatMap((question) => meaningfulTerms(question));
  if (terms.length === 0) {
    return undefined;
  }

  return signals.find((signal) => {
    if (signal.basis === "needs_confirmation") {
      return false;
    }

    const text = signalText(signal);
    const hasQuestionTerm = terms.some((term) => text.includes(term));
    if (!hasQuestionTerm) {
      return false;
    }

    return signalHasNegativePresence(signal, text);
  });
}

function signalHasNegativePresence(signal: ScanSignal, text: string): boolean {
  if (Object.values(signal.metadata).some((value) => value === false)) {
    return true;
  }

  return /\b(no|not|none|absent|disabled|missing|without)\b/.test(text);
}

function meaningfulTerms(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 1 && !STOP_WORDS.has(term));
}

function signalText(signal: ScanSignal): string {
  return [signal.summary, ...signal.paths, JSON.stringify(signal.metadata)].join(" ").toLowerCase();
}

function signalBasisToJudgmentBasis(basis: ScanSignal["basis"]): JudgmentBasis {
  if (basis === "needs_confirmation") {
    return "inferred";
  }
  return basis;
}
