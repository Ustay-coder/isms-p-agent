import { buildAskContextBundle } from "../ask/context-builder.js";
import { renderAskContextJson, renderAskContextMarkdown } from "../ask/output.js";
import type { AskContextBundle } from "../schemas/ask-context.js";

export interface AskContextOptions {
  format: "json" | "markdown";
}

export async function buildAskContext(workspaceRoot: string, question: string): Promise<AskContextBundle> {
  const trimmed = question.trim();
  if (!trimmed) {
    throw new Error("Question is required. Usage: isms-agent ask-context <question> [--json] [--markdown]");
  }

  return buildAskContextBundle(workspaceRoot, trimmed);
}

export async function runAskContext(
  workspaceRoot: string,
  question: string,
  options: AskContextOptions = { format: "json" }
): Promise<string> {
  const context = await buildAskContext(workspaceRoot, question);
  return options.format === "markdown" ? renderAskContextMarkdown(context) : renderAskContextJson(context);
}

export function parseAskContextArgs(args: string[]): { question: string; options: AskContextOptions } | undefined {
  let format: AskContextOptions["format"] = "json";
  let explicitFormat: AskContextOptions["format"] | undefined;
  const questionParts = [];

  for (const arg of args) {
    if (arg === "--json" || arg === "--markdown") {
      const requested = arg === "--json" ? "json" : "markdown";
      if (explicitFormat && requested !== explicitFormat) {
        return undefined;
      }
      explicitFormat = requested;
      format = requested;
      continue;
    }

    if (arg.startsWith("--")) {
      return undefined;
    }

    questionParts.push(arg);
  }

  const question = questionParts.join(" ").trim();
  if (!question) {
    return undefined;
  }

  return {
    question,
    options: { format }
  };
}
