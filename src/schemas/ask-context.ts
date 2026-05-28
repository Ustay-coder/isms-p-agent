import type { ControlAnalysisResult } from "./analysis.js";
import type { ScanSignal } from "./scan.js";

export type AskIntent = "control_status" | "backlog" | "evidence" | "gap_summary" | "source_trace" | "general";

export interface RelevantControlContext extends ControlAnalysisResult {
  relevance: {
    score: number;
    reasons: string[];
  };
}

export interface AskContextBundle {
  schemaVersion: 1;
  generatedAt: string;
  question: string;
  intent: AskIntent;
  relevantControls: RelevantControlContext[];
  relevantSignals: ScanSignal[];
  relevantReports: string[];
  facts: string[];
  answerConstraints: string[];
}
