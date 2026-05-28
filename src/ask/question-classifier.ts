import type { AskIntent } from "../schemas/ask-context.js";

export interface ClassifiedQuestion {
  intent: AskIntent;
  controlIds: string[];
  terms: string[];
}

const CONTROL_ID_PATTERN = /\b\d+(?:\.\d+)+\b/g;

export function classifyQuestion(question: string): ClassifiedQuestion {
  const normalized = normalize(question);
  const controlIds = [...question.matchAll(CONTROL_ID_PATTERN)].map((match) => match[0]);

  return {
    intent: classifyIntent(normalized, controlIds),
    controlIds,
    terms: termsFrom(question)
  };
}

function classifyIntent(normalized: string, controlIds: string[]): AskIntent {
  if (controlIds.length > 0) {
    return "control_status";
  }

  if (hasAny(normalized, ["증적", "evidence", "proof", "입증", "후보"])) {
    return "evidence";
  }

  if (hasAny(normalized, ["backlog", "next", "먼저", "이번 주", "이번주", "이번 달", "이번달", "처리", "작업"])) {
    return "backlog";
  }

  if (hasAny(normalized, ["gap", "missing", "부족", "위험", "리스크", "누락", "취약"])) {
    return "gap_summary";
  }

  if (hasAny(normalized, ["source", "출처", "근거", "trace", "어디서", "원문"])) {
    return "source_trace";
  }

  return "general";
}

function termsFrom(question: string): string[] {
  const normalized = normalize(question);
  return normalized
    .split(/[^a-z0-9가-힣.]+/i)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);
}

function hasAny(input: string, terms: string[]): boolean {
  return terms.some((term) => input.includes(term));
}

export function normalize(input: string): string {
  return input.toLowerCase().replace(/\s+/g, " ").trim();
}
