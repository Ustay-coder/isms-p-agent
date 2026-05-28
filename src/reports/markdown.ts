import type { SourceRef } from "../schemas/control.js";

export function markdownList(items: string[], emptyText = "None identified."): string {
  if (items.length === 0) {
    return `- ${emptyText}`;
  }
  return items.map((item) => `- ${item}`).join("\n");
}

export function sourceRefList(sourceRefs: SourceRef[]): string {
  if (sourceRefs.length === 0) {
    return "- No source refs recorded.";
  }

  return sourceRefs
    .map((ref) => {
      const excerpt = ref.excerpt ? ` - ${ref.excerpt}` : "";
      return `- ${ref.sourcePath} (${ref.sha256})${excerpt}`;
    })
    .join("\n");
}

export function markdownTable(headers: string[], rows: string[][]): string {
  const header = `| ${headers.map(escapeCell).join(" | ")} |`;
  const separator = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`).join("\n");
  return body ? `${header}\n${separator}\n${body}` : `${header}\n${separator}`;
}

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", "<br>");
}
