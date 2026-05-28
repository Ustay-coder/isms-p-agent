import type { ControlAnalysisResult } from "../schemas/analysis.js";
import { markdownList } from "./markdown.js";

type Horizon = "this week" | "this month" | "before certification readiness review";

interface BacklogItem {
  horizon: Horizon;
  task: string;
  status: ControlAnalysisResult["status"];
  reason: string;
  controlIds: string[];
  owner: string;
  priority: "high" | "medium" | "low";
  expectedEvidence: string;
  humanApproval: string;
}

const HORIZONS: Horizon[] = ["this week", "this month", "before certification readiness review"];

export function renderBacklog(analyses: ControlAnalysisResult[]): string {
  const items = analyses.flatMap(toBacklogItems);
  const sections = HORIZONS.map((horizon) => {
    const scoped = items.filter((item) => item.horizon === horizon);
    return [`## ${horizon}`, scoped.length === 0 ? "- No immediate tasks generated for this horizon." : scoped.map(renderItem).join("\n\n")].join("\n\n");
  });

  return [
    "# ISMS-P Readiness Backlog",
    "This backlog is based on conservative analyzer output. Evidence described here is candidate evidence and requires human review before certification use.",
    ...sections
  ].join("\n\n") + "\n";
}

function toBacklogItems(result: ControlAnalysisResult): BacklogItem[] {
  if (result.status === "not_applicable" || result.status === "satisfied") {
    return [];
  }

  if (result.status === "needs_confirmation") {
    return [{
      horizon: "this week",
      task: `Collect missing scanner inputs for ${result.control_id} ${result.title}`,
      status: result.status,
      reason: "The analyzer needs confirmation before judging this control.",
      controlIds: [result.control_id],
      owner: "security owner with service/platform owner",
      priority: "high",
      expectedEvidence: "Candidate evidence showing scanner coverage, applicability answers, or source documents.",
      humanApproval: "Required for applicability and readiness judgment."
    }];
  }

  const priority = result.status === "gap" ? "high" : "medium";
  return [
    {
      horizon: "this week",
      task: `Close immediate missing items for ${result.control_id} ${result.title}`,
      status: result.status,
      reason: result.missing.length > 0 ? `Missing: ${result.missing.join(", ")}` : "Analyzer found incomplete control evidence.",
      controlIds: [result.control_id],
      owner: "control owner",
      priority,
      expectedEvidence: expectedEvidence(result),
      humanApproval: "Required before treating candidate evidence as readiness evidence."
    },
    {
      horizon: "this month",
      task: `Document operating practice for ${result.control_id} ${result.title}`,
      status: result.status,
      reason: "Technical configuration alone does not prove operated governance.",
      controlIds: [result.control_id],
      owner: "security owner with process owner",
      priority,
      expectedEvidence: expectedEvidence(result),
      humanApproval: "Required for operating practice approval."
    },
    {
      horizon: "before certification readiness review",
      task: `Review candidate evidence for ${result.control_id} ${result.title}`,
      status: result.status,
      reason: "Candidate evidence needs human review before certification readiness review.",
      controlIds: [result.control_id],
      owner: "certification readiness owner",
      priority: "medium",
      expectedEvidence: expectedEvidence(result),
      humanApproval: "Required."
    }
  ];
}

function renderItem(item: BacklogItem): string {
  return markdownList([
    `Task: ${item.task}`,
    `Analyzer status: ${item.status}`,
    `Reason: ${item.reason}`,
    `Mapped control IDs: ${item.controlIds.join(", ")}`,
    `Owner suggestion: ${item.owner}`,
    `Priority: ${item.priority}`,
    `Expected candidate evidence after completion: ${item.expectedEvidence}`,
    `Human approval required: ${item.humanApproval}`
  ]);
}

function expectedEvidence(result: ControlAnalysisResult): string {
  return result.required_evidence.length > 0
    ? result.required_evidence.join(", ")
    : "Candidate evidence agreed by the control owner.";
}
