import { normalize, type ClassifiedQuestion } from "./question-classifier.js";
import type { ControlAnalysisResult } from "../schemas/analysis.js";
import type { ControlKnowledge } from "../schemas/control.js";
import type { RelevantControlContext } from "../schemas/ask-context.js";
import type { ScanSignal } from "../schemas/scan.js";

export interface AnalyzedControl {
  control: ControlKnowledge;
  analysis: ControlAnalysisResult;
}

export function rankControls(classified: ClassifiedQuestion, controls: AnalyzedControl[]): RelevantControlContext[] {
  return controls
    .map((entry) => {
      const relevance = scoreControl(classified, entry);
      return { ...entry.analysis, relevance };
    })
    .filter((entry) => entry.relevance.score > 0)
    .sort((left, right) => {
      const scoreComparison = right.relevance.score - left.relevance.score;
      return scoreComparison === 0 ? left.control_id.localeCompare(right.control_id, "en") : scoreComparison;
    })
    .slice(0, 5);
}

export function relevantSignals(controls: RelevantControlContext[], signals: ScanSignal[]): ScanSignal[] {
  const selected = [];
  const seen = new Set<string>();

  for (const signal of signals) {
    if (!matchesSelectedControl(signal, controls)) {
      continue;
    }
    if (seen.has(signal.id)) {
      continue;
    }
    selected.push(signal);
    seen.add(signal.id);
    if (selected.length >= 10) {
      break;
    }
  }

  return selected;
}

function scoreControl(classified: ClassifiedQuestion, entry: AnalyzedControl): RelevantControlContext["relevance"] {
  const reasons: string[] = [];
  let score = 0;

  if (classified.controlIds.includes(entry.control.control_id)) {
    score += 100;
    reasons.push("exact control ID match");
  }

  const title = normalize(entry.control.title);
  if (classified.terms.some((term) => title.includes(normalize(term)))) {
    score += 40;
    reasons.push("control title match");
  }

  const controlText = controlSearchText(entry.control);
  const analysisText = analysisSearchText(entry.analysis);
  const matchedTerms = classified.terms.filter((term) => {
    const normalizedTerm = normalize(term);
    return normalizedTerm.length > 1 && (controlText.includes(normalizedTerm) || analysisText.includes(normalizedTerm));
  });
  if (matchedTerms.length > 0) {
    score += Math.min(30, matchedTerms.length * 5);
    reasons.push("question terms match control or analysis text");
  }

  if (classified.intent === "backlog" && ["gap", "partial", "needs_confirmation"].includes(entry.analysis.status)) {
    score += statusBacklogScore(entry.analysis.status);
    reasons.push("unresolved control for backlog");
  }

  if (classified.intent === "evidence" && (entry.analysis.required_evidence.length > 0 || entry.analysis.observed_evidence.length > 0)) {
    score += 25;
    reasons.push("evidence-related control");
  }

  if (classified.intent === "gap_summary" && ["gap", "partial", "needs_confirmation"].includes(entry.analysis.status)) {
    score += statusBacklogScore(entry.analysis.status);
    reasons.push("unresolved control for gap summary");
  }

  if (classified.intent === "source_trace" && entry.analysis.source_refs.length > 0) {
    score += 20;
    reasons.push("source references available");
  }

  if (score === 0 && classified.intent === "general") {
    score += entry.analysis.status === "satisfied" || entry.analysis.status === "not_applicable" ? 1 : 5;
    reasons.push("general workspace context");
  }

  return { score, reasons };
}

function matchesSelectedControl(signal: ScanSignal, controls: RelevantControlContext[]): boolean {
  const signalText = normalize([signal.summary, ...signal.paths, JSON.stringify(signal.metadata)].join(" "));
  return controls.some((control) => {
    const controlTerms = [
      control.control_id,
      control.title,
      ...control.observed_evidence,
      ...control.missing,
      ...control.required_evidence,
      ...control.recommended_actions
    ].map(normalize);
    return controlTerms.some((term) => term.length > 1 && signalText.includes(term));
  });
}

function statusBacklogScore(status: ControlAnalysisResult["status"]): number {
  if (status === "gap") {
    return 35;
  }
  if (status === "partial") {
    return 30;
  }
  return 25;
}

function controlSearchText(control: ControlKnowledge): string {
  return normalize([
    control.control_id,
    control.title,
    control.domain,
    control.category,
    control.requirement,
    control.intent,
    ...control.applicability_questions,
    ...control.observable_signals,
    ...control.required_operating_practices,
    ...control.required_evidence,
    ...control.common_defects
  ].join(" "));
}

function analysisSearchText(analysis: ControlAnalysisResult): string {
  return normalize([
    analysis.control_id,
    analysis.title,
    analysis.status,
    ...analysis.observed_evidence,
    ...analysis.missing,
    ...analysis.recommended_actions,
    ...analysis.required_evidence,
    ...analysis.source_refs.map((source) => `${source.sourcePath} ${source.excerpt}`)
  ].join(" "));
}
