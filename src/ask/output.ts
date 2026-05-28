import type { AskContextBundle } from "../schemas/ask-context.js";

export function renderAskContextJson(context: AskContextBundle): string {
  return `${JSON.stringify(context, null, 2)}\n`;
}

export function renderAskContextMarkdown(context: AskContextBundle): string {
  return [
    "# Ask Context",
    "",
    `**Question:** ${context.question}`,
    `**Intent:** ${context.intent}`,
    "",
    "## Relevant Controls",
    "",
    ...controlLines(context),
    "## Relevant Signals",
    "",
    ...signalLines(context),
    "## Facts",
    "",
    ...listOrFallback(context.facts, "No facts selected."),
    "## Relevant Reports",
    "",
    ...listOrFallback(context.relevantReports, "No report references selected."),
    "## Answer Constraints",
    "",
    ...listOrFallback(context.answerConstraints, "No answer constraints selected.")
  ].join("\n");
}

function controlLines(context: AskContextBundle): string[] {
  if (context.relevantControls.length === 0) {
    return ["No relevant controls selected.", ""];
  }

  return context.relevantControls.flatMap((control) => [
    `### ${control.control_id} ${control.title}`,
    "",
    `- Status: ${control.status}`,
    `- Confidence: ${control.confidence}`,
    `- Basis: ${control.judgment_basis}`,
    `- Relevance: ${control.relevance.score} (${control.relevance.reasons.join(", ")})`,
    `- Observed candidate evidence: ${control.observed_evidence.length > 0 ? control.observed_evidence.join("; ") : "none"}`,
    `- Missing: ${control.missing.length > 0 ? control.missing.join("; ") : "none"}`,
    `- Recommended actions: ${control.recommended_actions.length > 0 ? control.recommended_actions.join("; ") : "none"}`,
    `- Required evidence: ${control.required_evidence.length > 0 ? control.required_evidence.join("; ") : "none"}`,
    ""
  ]);
}

function signalLines(context: AskContextBundle): string[] {
  if (context.relevantSignals.length === 0) {
    return ["No relevant scan signals selected.", ""];
  }

  return context.relevantSignals.flatMap((signal) => [
    `- ${signal.id}: ${signal.source} / ${signal.basis} / ${signal.summary}`,
    `  - Paths: ${signal.paths.length > 0 ? signal.paths.join(", ") : "none"}`,
    ""
  ]);
}

function listOrFallback(values: string[], fallback: string): string[] {
  if (values.length === 0) {
    return [`- ${fallback}`, ""];
  }

  return [...values.map((value) => `- ${value}`), ""];
}
