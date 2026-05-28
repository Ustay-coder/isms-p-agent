import { assessApplicability, type ApplicabilityAnswers } from "./applicability.js";
import type { ControlAnalysisResult, JudgmentBasis } from "../schemas/analysis.js";
import type { ControlKnowledge } from "../schemas/control.js";
import type { ScanSignal } from "../schemas/scan.js";

export function analyzeControls(
  controls: ControlKnowledge[],
  signals: ScanSignal[],
  applicabilityAnswers: ApplicabilityAnswers = {}
): ControlAnalysisResult[] {
  return controls.map((control) => analyzeControl(control, signals, applicabilityAnswers));
}

function analyzeControl(
  control: ControlKnowledge,
  signals: ScanSignal[],
  applicabilityAnswers: ApplicabilityAnswers
): ControlAnalysisResult {
  const applicability = assessApplicability(control, signals, applicabilityAnswers);
  if (applicability.applicable === false) {
    return result(control, {
      status: "not_applicable",
      observed_evidence: applicability.reason ? [applicability.reason] : [],
      missing: [],
      recommended_actions: [],
      confidence: applicability.basis === "user-confirmed" ? "high" : "medium",
      judgment_basis: applicability.basis ?? "inferred"
    });
  }

  if (signals.length === 0 || signals.every((signal) => signal.basis === "needs_confirmation")) {
    return result(control, {
      status: "needs_confirmation",
      observed_evidence: [],
      missing: ["scanner coverage"],
      recommended_actions: ["Collect scanner coverage for this control before judging satisfaction."],
      confidence: "low",
      judgment_basis: "inferred"
    });
  }

  const technicalMatches = matchingSignals(control.observable_signals, signals, (signal) => signal.basis !== "needs_confirmation");
  const operatingMatches = matchingSignals(operatingTerms(control), signals, (signal) => {
    return signal.basis === "document-backed" && signal.source === "local-docs";
  });
  const confirmationMatches = matchingSignals([...control.observable_signals, ...operatingTerms(control)], signals, (signal) => {
    return signal.basis === "needs_confirmation";
  });

  if (confirmationMatches.length > 0 && technicalMatches.length === 0) {
    return result(control, {
      status: "needs_confirmation",
      observed_evidence: evidenceSummaries(confirmationMatches),
      missing: ["scanner coverage"],
      recommended_actions: ["Collect scanner coverage for this control before judging satisfaction."],
      confidence: "low",
      judgment_basis: "inferred"
    });
  }

  const observedEvidence = evidenceSummaries([...technicalMatches, ...operatingMatches]);
  const missing = missingTerms(control, technicalMatches, operatingMatches);
  const hasTechnicalSignal = technicalMatches.length > 0;

  if (hasTechnicalSignal && allRequiredOperatingTermsMatched(control, operatingMatches)) {
    return result(control, {
      status: "satisfied",
      observed_evidence: observedEvidence,
      missing: [],
      recommended_actions: [],
      confidence: "high",
      judgment_basis: strongestBasis([...technicalMatches, ...operatingMatches])
    });
  }

  if (hasTechnicalSignal) {
    return result(control, {
      status: "partial",
      observed_evidence: observedEvidence,
      missing,
      recommended_actions: actionStrings(missing),
      confidence: "medium",
      judgment_basis: strongestBasis([...technicalMatches, ...operatingMatches])
    });
  }

  return result(control, {
    status: "gap",
    observed_evidence: observedEvidence,
    missing,
    recommended_actions: actionStrings(missing),
    confidence: "medium",
    judgment_basis: strongestBasis([...technicalMatches, ...operatingMatches])
  });
}

function result(
  control: ControlKnowledge,
  analysis: Omit<ControlAnalysisResult, "control_id" | "title" | "required_evidence" | "source_refs">
): ControlAnalysisResult {
  return {
    control_id: control.control_id,
    title: control.title,
    required_evidence: control.required_evidence,
    source_refs: control.source_refs,
    ...analysis
  };
}

function matchingSignals(
  terms: string[],
  signals: ScanSignal[],
  predicate: (signal: ScanSignal) => boolean
): ScanSignal[] {
  const normalizedTerms = terms.map(normalize).filter(Boolean);
  if (normalizedTerms.length === 0) {
    return [];
  }

  return signals.filter((signal) => predicate(signal) && normalizedTerms.some((term) => signalText(signal).includes(term)));
}

function missingTerms(control: ControlKnowledge, technicalMatches: ScanSignal[], operatingMatches: ScanSignal[]): string[] {
  const missingTechnical = control.observable_signals.filter((term) => !matchesAny(term, technicalMatches));
  const missingOperating = operatingTerms(control).filter((term) => !matchesAny(term, operatingMatches));
  return [...missingTechnical, ...missingOperating];
}

function operatingTerms(control: ControlKnowledge): string[] {
  return [...control.required_operating_practices, ...control.required_evidence];
}

function allRequiredOperatingTermsMatched(control: ControlKnowledge, operatingMatches: ScanSignal[]): boolean {
  const terms = operatingTerms(control);
  return terms.length > 0 && terms.every((term) => matchesAny(term, operatingMatches));
}

function matchesAny(term: string, signals: ScanSignal[]): boolean {
  const normalizedTerm = normalize(term);
  return normalizedTerm.length > 0 && signals.some((signal) => signalText(signal).includes(normalizedTerm));
}

function evidenceSummaries(signals: ScanSignal[]): string[] {
  const summaries = new Set<string>();
  for (const signal of signals) {
    summaries.add(signal.summary);
  }
  return [...summaries];
}

function actionStrings(missing: string[]): string[] {
  return missing.map((term) => `Provide or document evidence for: ${term}`);
}

function strongestBasis(signals: ScanSignal[]): JudgmentBasis {
  const bases = signals.map((signal) => signalBasisToJudgmentBasis(signal.basis));
  if (bases.includes("document-backed")) {
    return "document-backed";
  }
  if (bases.includes("observed")) {
    return "observed";
  }
  return "inferred";
}

function signalBasisToJudgmentBasis(basis: ScanSignal["basis"]): JudgmentBasis {
  if (basis === "needs_confirmation") {
    return "inferred";
  }
  return basis;
}

function signalText(signal: ScanSignal): string {
  return normalize([signal.summary, ...signal.paths, JSON.stringify(signal.metadata)].join(" "));
}

function normalize(input: string): string {
  return input.toLowerCase().replace(/\s+/g, " ").trim();
}
