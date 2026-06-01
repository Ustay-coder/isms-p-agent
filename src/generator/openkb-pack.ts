import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { stringifyJson } from "../core/json.js";
import { readJsonl } from "../core/jsonl.js";
import type {
  ControlKnowledge,
  ControlRequirement,
  PackEffectiveStatus,
  PackSourceConfidence,
  SourceRef
} from "../schemas/control.js";
import type {
  AnnexMappingRow,
  EvidenceRequirementRow,
  GeneratePackOptions,
  GeneratePackResult,
  RawLegalRow,
  SourceClaimRow
} from "./openkb-types.js";

const ANNEX_7_2_PATH = "compiled/controls/annex_7_2_mapping.jsonl";
const SOURCE_CLAIMS_PATH = "compiled/citations/source_claims.jsonl";
const EVIDENCE_REQUIREMENTS_PATH = "compiled/evidence/evidence_requirements.jsonl";
const RAW_LEGAL_PROFILE_PATH = "raw/legal/7의2_ISMS-P_인증기준_항목_목록.jsonl";
export const SUPPORTED_ANNEX_7_2_CONTROLS = "@annex-7-2-supported";

export async function selectSupportedControlIdsFromOpenKb(openkbRoot: string): Promise<string[]> {
  const annexRows = await readJsonl<AnnexMappingRow>(join(openkbRoot, ANNEX_7_2_PATH));
  return selectSupportedAnnex72ControlIds(annexRows);
}

export function selectSupportedAnnex72ControlIds(rows: AnnexMappingRow[]): string[] {
  return rows
    .filter((row) => (row.status === "유지" || row.status === "삭제") && !row.merged_into)
    .map((row) => {
      assertSupportedControlId(row.control_id);
      return row.control_id;
    });
}

export async function generatePackFromOpenKb(options: GeneratePackOptions): Promise<GeneratePackResult> {
  const annexRows = await readJsonl<AnnexMappingRow>(join(options.openkbRoot, ANNEX_7_2_PATH));
  const claimRows = await readJsonl<SourceClaimRow>(join(options.openkbRoot, SOURCE_CLAIMS_PATH));
  const evidenceRows = await readJsonl<EvidenceRequirementRow>(join(options.openkbRoot, EVIDENCE_REQUIREMENTS_PATH));
  const rawLegalRows = await readOptionalJsonl<RawLegalRow>(join(options.openkbRoot, RAW_LEGAL_PROFILE_PATH));
  const wikiFiles = await findWikiControlFiles(join(options.openkbRoot, "wiki", "controls"));
  const targetControlIds = options.controlIds.length === 1 && options.controlIds[0] === SUPPORTED_ANNEX_7_2_CONTROLS
    ? selectSupportedAnnex72ControlIds(annexRows)
    : options.controlIds;

  const selectedControls = targetControlIds.map((controlId) => {
    const annex = annexRows.find((row) => row.control_id === controlId);
    if (!annex) {
      throw new Error(`OpenKB annex mapping is missing ${controlId}`);
    }
    assertSupportedControlId(annex.control_id);
    assertNotMergedControl(annex);
    const claim = claimRows.find((row) => row.control_id === controlId);
    if (!claim) {
      throw new Error(`OpenKB source claims are missing ${controlId}`);
    }

    return buildControl({
      packName: options.packName,
      annex,
      claim,
      evidence: evidenceRows.filter((row) => row.control_id === controlId),
      wikiPath: selectWikiControlFile(wikiFiles, annex),
      openkbRoot: options.openkbRoot
    });
  });

  await rm(join(options.packRoot, "controls"), { recursive: true, force: true });
  await mkdir(join(options.packRoot, "controls"), { recursive: true });
  await mkdir(join(options.packRoot, "sources"), { recursive: true });

  for (const control of selectedControls) {
    await writeFile(join(options.packRoot, "controls", `${control.control_id}.json`), stringifyJson(control));
  }

  await writeFile(join(options.packRoot, "pack.json"), stringifyJson({
    schemaVersion: 1,
    name: options.packName,
    version: options.version,
    sourceOfTruth: "openkb",
    sourceRootKind: "openkb-relative",
    controlCount: selectedControls.length,
    controls: selectedControls.map((control) => control.control_id),
    reviewStatus: "needs_human_review",
    sourceConfidence: "ocr_derived",
    publicSafety: {
      containsPrivateServicePaths: false,
      containsCustomerData: false,
      containsSensitiveCredentials: false
    }
  }));

  await writeFile(join(options.packRoot, "sources", "source-manifest.json"), stringifyJson({
    schemaVersion: 1,
    sourceOfTruth: "openkb",
    openkbRoot: "openkb-relative",
    openkbSources: unique([
      ANNEX_7_2_PATH,
      SOURCE_CLAIMS_PATH,
      EVIDENCE_REQUIREMENTS_PATH,
      ...selectedControls
        .flatMap((control) => control.source_refs.map((sourceRef) => sourceRef.sourcePath))
        .filter((sourcePath) => sourcePath.startsWith("wiki/"))
    ]),
    sourceProfileReferences: rawLegalRows.length > 0 ? [
      {
        path: RAW_LEGAL_PROFILE_PATH,
        purpose: "source-profile cross-check; do not treat as direct control source for generated pack IDs"
      }
    ] : [],
    knownSourceProfileConflicts: detectRawLegalConflicts(selectedControls, rawLegalRows),
    privateOverlaysIncluded: false
  }));

  return {
    packRoot: options.packRoot,
    generatedControls: selectedControls.map((control) => control.control_id)
  };
}

function buildControl(input: {
  packName: string;
  annex: AnnexMappingRow;
  claim?: SourceClaimRow;
  evidence: EvidenceRequirementRow[];
  wikiPath?: string;
  openkbRoot: string;
}): ControlKnowledge {
  const effectiveStatus = mapEffectiveStatus(input.annex.status);
  const evidenceTitles = input.evidence.map((row) => toPublicText(row.title));
  const wikiSourcePath = input.wikiPath ? normalizeOpenKbPath(input.openkbRoot, input.wikiPath) : undefined;
  const evidenceSourceRef: SourceRef = {
    sourcePath: EVIDENCE_REQUIREMENTS_PATH,
    sha256: "openkb-managed",
    excerpt: input.evidence.map((row) => row.evidence_id).join(", ")
  };
  const wikiSourceRef: SourceRef | undefined = wikiSourcePath ? {
    sourcePath: wikiSourcePath,
    sha256: "openkb-managed",
    excerpt: `${input.annex.control_id} ${input.annex.control_name}`
  } : undefined;

  return {
    schemaVersion: 1,
    control_id: input.annex.control_id,
    title: input.annex.control_name,
    domain: input.annex.part,
    category: input.evidence[0]?.domain_name ?? input.annex.domain_id,
    requirement: buildRequirement(input.annex, input.evidence),
    intent: buildIntent(input.annex, effectiveStatus),
    applicability_questions: buildApplicabilityQuestions(input.annex, effectiveStatus),
    observable_signals: buildObservableSignals(input.annex, input.evidence),
    required_operating_practices: buildOperatingPractices(input.annex, effectiveStatus),
    required_evidence: evidenceTitles.length > 0 ? evidenceTitles : [`${input.annex.control_name} 검토 기록`],
    requirements: buildControlRequirements(input.annex, input.evidence, wikiSourceRef),
    common_defects: buildCommonDefects(input.annex, effectiveStatus),
    automation_potential: input.evidence.some((row) => row.automation_candidate) ? "partial" : "none",
    human_review_required: true,
    source_refs: [
      {
        sourcePath: ANNEX_7_2_PATH,
        sha256: "openkb-managed",
        excerpt: `${input.annex.control_id} ${input.annex.control_name} status ${input.annex.status}`
      },
      ...(input.claim ? [{
        sourcePath: SOURCE_CLAIMS_PATH,
        sha256: "openkb-managed",
        excerpt: input.claim.claim_id
      }] : []),
      ...(input.evidence.length > 0 ? [evidenceSourceRef] : []),
      ...(wikiSourceRef ? [wikiSourceRef] : [])
    ],
    pack: {
      name: input.packName,
      source_of_truth: "openkb",
      openkb_control_id: input.annex.control_id,
      effective_status: effectiveStatus,
      review_status: "needs_human_review",
      source_confidence: mapSourceConfidence(input.claim?.confidence)
    }
  } as ControlKnowledge;
}

function buildControlRequirements(
  annex: AnnexMappingRow,
  evidence: EvidenceRequirementRow[],
  wikiSourceRef?: SourceRef
): ControlRequirement[] {
  return evidence.map((row) => ({
    requirement_id: `${annex.control_id}.${slugRequirementId(row.evidence_id)}`,
    control_id: annex.control_id,
    title: toPublicText(row.title),
    kind: mapRequirementKind(row.evidence_type),
    required: true,
    evidence_types: unique([row.evidence_type]),
    review_frequency: mapReviewFrequency(row.refresh_cycle),
    source_refs: [
      {
        sourcePath: EVIDENCE_REQUIREMENTS_PATH,
        sha256: "openkb-managed",
        excerpt: row.evidence_id
      },
      ...(wikiSourceRef ? [wikiSourceRef] : [])
    ]
  }));
}

function slugRequirementId(value: string): string {
  return value
    .toLowerCase()
    .replace(/^ev-/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function mapRequirementKind(evidenceType: string): ControlRequirement["kind"] {
  if (evidenceType === "system_config" || evidenceType === "system_export") {
    return "configuration";
  }
  if (evidenceType === "code_reference") {
    return "implementation";
  }
  if (evidenceType === "log") {
    return "log";
  }
  if (
    evidenceType === "contract" ||
    evidenceType === "crosswalk" ||
    evidenceType === "mapping" ||
    evidenceType === "privacy_contract" ||
    evidenceType === "scope_statement"
  ) {
    return "applicability";
  }
  if (evidenceType === "policy" || evidenceType === "privacy_policy" || evidenceType === "procedure") {
    return "policy";
  }
  return "operation_record";
}

function mapReviewFrequency(refreshCycle: string | undefined): ControlRequirement["review_frequency"] | undefined {
  if (!refreshCycle) {
    return undefined;
  }
  if (refreshCycle.includes("on_change")) {
    return "per_change";
  }
  if (refreshCycle.includes("monthly")) {
    return "monthly";
  }
  if (refreshCycle.includes("quarterly")) {
    return "quarterly";
  }
  if (refreshCycle.includes("semiannual")) {
    return "semiannual";
  }
  if (refreshCycle.includes("annual")) {
    return "annual";
  }
  return undefined;
}

function mapEffectiveStatus(status: string): PackEffectiveStatus {
  if (status === "유지") {
    return "active";
  }
  if (status === "삭제") {
    return "deleted_residual_risk";
  }
  throw new Error(`Unsupported OpenKB control status: ${status}`);
}

function mapSourceConfidence(confidence: string | undefined): PackSourceConfidence {
  if (confidence === "official_verified" || confidence === "human_curated") {
    return confidence;
  }
  return "ocr_derived";
}

function buildRequirement(annex: AnnexMappingRow, evidence: EvidenceRequirementRow[]): string {
  const firstCriterion = evidence[0]?.acceptance_criteria;
  return firstCriterion ? `${annex.control_name}: ${toPublicText(firstCriterion)}` : `${annex.control_name} 요구사항은 OpenKB 검토가 필요하다.`;
}

function buildIntent(annex: AnnexMappingRow, status: PackEffectiveStatus): string {
  if (status === "deleted_residual_risk") {
    return `Preserve traceability for deleted control ${annex.control_id} ${annex.control_name} and require residual-risk review before treating it as not applicable.`;
  }
  return `Confirm operating coverage for ${annex.control_id} ${annex.control_name} using OpenKB-derived evidence requirements.`;
}

function buildApplicabilityQuestions(annex: AnnexMappingRow, status: PackEffectiveStatus): string[] {
  if (status === "deleted_residual_risk") {
    return [
      `Does ${annex.control_name} remain relevant through contracts, privacy obligations, or customer security requirements?`,
      "Has a human owner confirmed the deleted-control residual risk?"
    ];
  }
  return [
    `Does the service operate systems or data flows covered by ${annex.control_name}?`,
    `Is there an owner for reviewing ${annex.control_name} evidence?`
  ];
}

function buildObservableSignals(annex: AnnexMappingRow, evidence: EvidenceRequirementRow[]): string[] {
  return unique([
    annex.control_name,
    ...evidence.map((row) => toPublicText(row.title)),
    ...evidence.map((row) => row.evidence_type)
  ]);
}

function buildOperatingPractices(annex: AnnexMappingRow, status: PackEffectiveStatus): string[] {
  if (status === "deleted_residual_risk") {
    return [
      "deleted-control decision review",
      "residual risk assessment",
      "human confirmation before treating the control as not applicable"
    ];
  }
  return [
    `${annex.control_name} policy ownership and review cycle`,
    `${annex.control_name} evidence review`,
    `${annex.control_name} exception approval`
  ];
}

function buildCommonDefects(annex: AnnexMappingRow, status: PackEffectiveStatus): string[] {
  if (status === "deleted_residual_risk") {
    return [
      "treating the deleted control as if no residual risk exists",
      "creating a normal remediation gap from a deleted control",
      "missing human confirmation for deleted-control applicability"
    ];
  }
  return [
    `${annex.control_name} evidence exists but has no owner`,
    `${annex.control_name} settings are captured once but not reviewed`,
    `${annex.control_name} exceptions are handled informally`
  ];
}

async function findWikiControlFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  await walk(root, files);
  return files.filter((path) => path.endsWith(".md")).sort();
}

async function walk(root: string, files: string[]): Promise<void> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(root, entry.name);
      if (entry.isDirectory()) {
        await walk(path, files);
      } else if (entry.isFile()) {
        files.push(path);
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

function assertSupportedControlId(controlId: string): void {
  if (!/^ISMS-P-\d+(?:\.\d+)+$/.test(controlId)) {
    throw new Error(`Unsupported OpenKB control_id for pack generation: ${controlId}`);
  }
}

function assertNotMergedControl(annex: AnnexMappingRow): void {
  if (annex.merged_into) {
    throw new Error(`OpenKB merged control ${annex.control_id} must be reviewed before generation: merged_into ${annex.merged_into}`);
  }
}

function selectWikiControlFile(paths: string[], annex: AnnexMappingRow): string | undefined {
  const expectedName = `${annex.control_id}_${annex.control_name.replace(/\s+/g, "_")}.md`;
  return paths.find((path) => basename(path) === expectedName);
}

function detectRawLegalConflicts(controls: ControlKnowledge[], rows: RawLegalRow[]): Array<{
  packControlId: string;
  packControlName: string;
  rawLegalControlId: string;
  rawLegalControlName: string;
}> {
  return controls.flatMap((control) => {
    const sameNameDifferentId = rows.find((row) => row.control_name === control.title && row.control_id !== control.control_id);
    return sameNameDifferentId ? [{
      packControlId: control.control_id,
      packControlName: control.title,
      rawLegalControlId: sameNameDifferentId.control_id,
      rawLegalControlName: sameNameDifferentId.control_name
    }] : [];
  });
}

async function readOptionalJsonl<T>(path: string): Promise<T[]> {
  try {
    return await readJsonl<T>(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function normalizeOpenKbPath(openkbRoot: string, path: string): string {
  return relative(openkbRoot, path).split("\\").join("/");
}

function toPublicText(value: string): string {
  return value
    .replace(/evaluate\.club/g, "the target service")
    .replace(/\/Users\/[^\s"']+/g, "local private path");
}

function unique(values: string[]): string[] {
  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);
}
