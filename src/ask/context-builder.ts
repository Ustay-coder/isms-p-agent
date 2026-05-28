import { analyzeControls } from "../analyzer/gap.js";
import { loadControls, loadLatestScan } from "../core/workspace-data.js";
import type { AskContextBundle, AskIntent, RelevantControlContext } from "../schemas/ask-context.js";
import type { ControlAnalysisResult } from "../schemas/analysis.js";
import type { ControlKnowledge } from "../schemas/control.js";
import type { ScanSignal } from "../schemas/scan.js";
import { classifyQuestion } from "./question-classifier.js";
import { rankControls, relevantSignals, type AnalyzedControl } from "./relevance.js";

export async function buildAskContextBundle(workspaceRoot: string, question: string): Promise<AskContextBundle> {
  const controls = await loadControls(workspaceRoot);
  const scan = await loadLatestScan(workspaceRoot);
  const analyses = analyzeControls(controls, scan.signals);
  const classified = classifyQuestion(question);
  const analyzed = pairControlsAndAnalyses(controls, analyses);
  const rankedControls = rankControls(classified, analyzed);
  const signals = relevantSignals(rankedControls, scan.signals);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    question,
    intent: classified.intent,
    relevantControls: rankedControls,
    relevantSignals: signals,
    relevantReports: reportsFor(classified.intent),
    facts: factsFor(rankedControls, signals),
    answerConstraints: answerConstraints()
  };
}

function pairControlsAndAnalyses(controls: ControlKnowledge[], analyses: ControlAnalysisResult[]): AnalyzedControl[] {
  const analysisByControlId = new Map(analyses.map((analysis) => [analysis.control_id, analysis]));
  return controls.map((control) => {
    const analysis = analysisByControlId.get(control.control_id);
    if (!analysis) {
      throw new Error(`Missing analysis for control ${control.control_id}`);
    }
    return { control, analysis };
  });
}

function reportsFor(intent: AskIntent): string[] {
  if (intent === "backlog") {
    return ["reports/backlog.md", "reports/control-gap-report.md", "reports/evidence-map.md"];
  }

  if (intent === "evidence") {
    return ["reports/evidence-map.md", "reports/control-gap-report.md"];
  }

  if (intent === "source_trace") {
    return ["reports/control-gap-report.md", "reports/evidence-map.md"];
  }

  return ["reports/control-gap-report.md", "reports/evidence-map.md", "reports/backlog.md"];
}

function factsFor(controls: RelevantControlContext[], signals: ScanSignal[]): string[] {
  const facts = [];

  for (const control of controls) {
    facts.push(
      `${control.control_id} ${control.title} status is ${control.status} with ${control.confidence} confidence.`
    );
    if (control.pack?.effective_status === "deleted_residual_risk") {
      facts.push(`${control.control_id} is a deleted residual-risk control from the OpenKB source of truth.`);
    }

    for (const evidence of control.observed_evidence) {
      facts.push(`Observed candidate evidence for ${control.control_id}: ${evidence}`);
    }

    for (const missing of control.missing) {
      facts.push(`Missing item for ${control.control_id}: ${missing}`);
    }
  }

  for (const signal of signals) {
    facts.push(`Signal ${signal.id} from ${signal.source} is ${signal.basis}: ${signal.summary}`);
  }

  return [...new Set(facts)].slice(0, 30);
}

function answerConstraints(): string[] {
  return [
    "Do not claim certification readiness from candidate evidence alone.",
    "Separate observed state from document-backed operating practice.",
    "Mark needs_confirmation and missing scanner coverage as uncertainty.",
    "Do not invent evidence or source references not present in this bundle.",
    "Do not include secrets, customer records, or personal data."
  ];
}
