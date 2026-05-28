import type { ControlKnowledge, SourceRef } from "../schemas/control.js";

const CONTROL_HEADING = /^##\s+(\d+(?:\.\d+)+)\s+(.+?)\s*$/gm;

export function parseMarkdownControls(markdown: string, sourceRef: SourceRef): ControlKnowledge[] {
  const matches = [...markdown.matchAll(CONTROL_HEADING)];

  return matches.map((match, index) => {
    const controlId = match[1] ?? "";
    const title = match[2] ?? "";
    const headingStart = match.index ?? 0;
    const bodyStart = headingStart + match[0].length;
    const nextHeadingStart = matches[index + 1]?.index ?? markdown.length;
    const body = markdown.slice(bodyStart, nextHeadingStart).trim();

    return {
      control_id: controlId,
      title,
      domain: "",
      category: "",
      requirement: body,
      intent: `${match[0]}${body.length > 0 ? `\n\n${body}` : ""}`,
      applicability_questions: [],
      observable_signals: [],
      required_operating_practices: [],
      required_evidence: [],
      common_defects: [],
      automation_potential: "partial",
      human_review_required: true,
      source_refs: [
        {
          ...sourceRef,
          excerpt: match[0].trim()
        }
      ]
    };
  });
}

export function safeControlFilename(controlId: string): string {
  return `${controlId.replace(/[^0-9A-Za-z.-]/g, "_")}.json`;
}
