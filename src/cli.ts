#!/usr/bin/env node
import { resolve } from "node:path";
import { parseAskContextArgs, runAskContext } from "./commands/ask-context.js";
import { addManualEvidence, CLOUDFLARE_BULK_ACCEPTED_ERROR, exportPublicEvidence, indexEvidenceFromScan, reviewCloudflareEvidence, reviewEvidence, validateEvidence, type EvidenceAddOptions } from "./commands/evidence.js";
import { initWorkspace } from "./commands/init.js";
import { ingestSource } from "./commands/ingest.js";
import { generatePack, installPack, parsePackGenerateArgs, validatePack } from "./commands/pack.js";
import { generateReports } from "./commands/report.js";
import { scanLocal, scanWorkspace, type ScanOptions } from "./commands/scan.js";
import { parseCloudflareProducts } from "./connectors/cloudflare-products.js";

const CLI_EVIDENCE_TYPES = new Set<EvidenceAddOptions["evidenceType"]>([
  "policy_document",
  "procedure_document",
  "configuration_export",
  "access_review_record",
  "change_approval_record",
  "audit_log",
  "implementation_file",
  "test_result",
  "connector_snapshot",
  "applicability_note"
]);

const CLI_EVIDENCE_ADD_CLASSIFICATIONS = new Set<EvidenceAddOptions["classification"]>([
  "internal",
  "confidential",
  "public_sample"
]);

async function main(argv: string[]): Promise<void> {
  const command = argv[2];
  const args = argv.slice(3);

  if (command === "init" && args.length === 0) {
    await initWorkspace(process.cwd());
    return;
  }

  if (command === "ingest" && args.length === 1) {
    await ingestSource(process.cwd(), args[0] ?? "");
    return;
  }

  if (command === "scan") {
    const options = parseScanOptions(args);
    if (options) {
      const cloudScanRequested = options.github || options.vercel || options.cloudflare;
      const result = options.local && !cloudScanRequested
        ? await scanLocal(process.cwd(), new Date(), { target: options.target, include: options.include, exclude: options.exclude })
        : await scanWorkspace(process.cwd(), options);
      console.log(result.outputPath);
      return;
    }
  }

  if (command === "report" && args.length <= 1) {
    if (args.length === 0 || args[0] === "--public") {
      const result = await generateReports(process.cwd(), { public: args[0] === "--public" });
      console.log(result.outputPaths.backlog);
      console.log(result.outputPaths.controlGapReport);
      console.log(result.outputPaths.evidenceMap);
      return;
    }
  }

  if (command === "evidence" && args[0] === "add") {
    const parsed = parseEvidenceAddArgs(args.slice(1));
    if (parsed) {
      const result = await addManualEvidence(process.cwd(), parsed);
      console.log(JSON.stringify(result, null, 2));
      return;
    }
  }

  if (command === "evidence" && args[0] === "index") {
    const parsed = parseEvidenceIndexArgs(args.slice(1));
    if (parsed) {
      const result = await indexEvidenceFromScan(process.cwd(), parsed);
      console.log(JSON.stringify(result, null, 2));
      return;
    }
  }

  if (command === "evidence" && args[0] === "review-cloudflare") {
    if (hasAcceptedCloudflareBulkDecision(args.slice(1))) {
      console.error(CLOUDFLARE_BULK_ACCEPTED_ERROR);
      process.exitCode = 1;
      return;
    }

    const parsed = parseCloudflareEvidenceReviewArgs(args.slice(1));
    if (parsed) {
      const result = await reviewCloudflareEvidence(process.cwd(), parsed);
      console.log(JSON.stringify(result, null, 2));
      return;
    }
  }

  if (command === "evidence" && args[0] === "review") {
    const parsed = parseEvidenceReviewArgs(args.slice(1));
    if (parsed) {
      const result = await reviewEvidence(process.cwd(), parsed);
      console.log(JSON.stringify(result, null, 2));
      return;
    }
  }

  if (command === "evidence" && args[0] === "export-public" && args.length === 1) {
    const result = await exportPublicEvidence(process.cwd());
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "evidence" && args[0] === "validate" && args.length <= 2) {
    if (args.length === 1 || (args.length === 2 && args[1] === "--public")) {
      const result = await validateEvidence(process.cwd(), { public: args[1] === "--public" });
      console.log(JSON.stringify(result, null, 2));
      if (!result.valid) {
        process.exitCode = 1;
      }
      return;
    }
  }

  if (command === "pack" && args[0] === "install") {
    const parsed = parsePackInstallArgs(args.slice(1));
    if (parsed) {
      const result = await installPack(process.cwd(), parsed);
      console.log(JSON.stringify(result, null, 2));
      return;
    }
  }

  if (command === "pack" && args[0] === "generate") {
    const parsed = parsePackGenerateArgs(args.slice(1));
    if (parsed) {
      const result = await generatePack(parsed);
      console.log(JSON.stringify(result, null, 2));
      return;
    }
  }

  if (command === "pack" && args[0] === "validate" && args.length <= 2) {
    const packRoot = args[1] ?? "packs/isms-p-core-v0";
    const result = await validatePack(resolve(process.cwd(), packRoot));
    console.log(JSON.stringify(result, null, 2));
    if (!result.valid) {
      process.exitCode = 1;
    }
    return;
  }

  if (command === "ask-context") {
    const parsed = parseAskContextArgs(args);
    if (parsed) {
      process.stdout.write(await runAskContext(process.cwd(), parsed.question, parsed.options));
      return;
    }
  }

  console.error("Usage: ismsp init");
  console.error("Usage: ismsp ingest <raw-file>");
  console.error("Usage: ismsp scan --local [--target path] [--include paths] [--exclude paths] [--github owner/repo] [--vercel project] [--cloudflare zone-or-zone-id] [--cloudflare-account account-id] [--cloudflare-products zone,access,waf,dns,workers,r2,hyperdrive,api-gateway]");
  console.error("Usage: ismsp report [--public]");
  console.error("Usage: ismsp evidence add --id <id> --title <text> --type <type> --classification <internal|confidential|public_sample> --supports <ids> --private-evidence evidence/private/... --summary <text> [--valid-until <iso>] [--metadata key=value]");
  console.error("Usage: ismsp evidence index [--from-scan scans/file.json]");
  console.error("Usage: ismsp evidence review <evidence-id> --requirement <id> --decision <accepted|rejected|needs_followup> --rationale <text> [--reviewer <name>] [--expires-at <iso>] [--private-evidence evidence/private/...]");
  console.error("Usage: ismsp evidence review-cloudflare [--decision needs_followup|rejected] [--rationale <text>] [--reviewer <name>] [--dry-run]");
  console.error("Usage: ismsp evidence export-public");
  console.error("Usage: ismsp evidence validate [--public]");
  console.error("Usage: ismsp pack install [pack-dir] [--overwrite]");
  console.error("Usage: ismsp pack generate --openkb <openkb-dir> --pack <pack-dir> --controls <ids|@annex-7-2-supported> [--version <version>]");
  console.error("Usage: ismsp pack validate [pack-dir]");
  console.error("Usage: ismsp ask-context <question> [--json] [--markdown]");
  process.exitCode = 1;
}

function parsePackInstallArgs(args: string[]): { packRoot: string; overwrite?: boolean } | undefined {
  if (args.length === 0) {
    return { packRoot: "packs/isms-p-core-v0" };
  }
  if (args.length === 1 && args[0] === "--overwrite") {
    return { packRoot: "packs/isms-p-core-v0", overwrite: true };
  }
  if (args.length === 1 && args[0] && !args[0].startsWith("--")) {
    return { packRoot: args[0] };
  }
  if (args.length === 2 && args[0] && !args[0].startsWith("--") && args[1] === "--overwrite") {
    return { packRoot: args[0], overwrite: true };
  }
  return undefined;
}

function parseEvidenceAddArgs(args: string[]): EvidenceAddOptions | undefined {
  let id: string | undefined;
  let title: string | undefined;
  let evidenceType: EvidenceAddOptions["evidenceType"] | undefined;
  let classification: EvidenceAddOptions["classification"] | undefined;
  const supports: string[] = [];
  let privateEvidencePath: string | undefined;
  let summary: string | undefined;
  let validUntil: string | undefined;
  const metadata: Record<string, string> = {};
  const scalarFlags = new Set<string>();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      return undefined;
    }

    if (arg === "--id") {
      if (!markScalarFlag(arg, scalarFlags)) {
        return undefined;
      }
      id = value;
    } else if (arg === "--title") {
      if (!markScalarFlag(arg, scalarFlags)) {
        return undefined;
      }
      title = value;
    } else if (arg === "--type") {
      if (!markScalarFlag(arg, scalarFlags)) {
        return undefined;
      }
      if (!isCliEvidenceType(value)) {
        return undefined;
      }
      evidenceType = value;
    } else if (arg === "--classification") {
      if (!markScalarFlag(arg, scalarFlags)) {
        return undefined;
      }
      if (!isCliEvidenceAddClassification(value)) {
        return undefined;
      }
      classification = value;
    } else if (arg === "--supports") {
      const parsedSupports = parseCommaSeparatedValues(value);
      if (parsedSupports.length === 0) {
        return undefined;
      }
      supports.push(...parsedSupports);
    } else if (arg === "--private-evidence") {
      if (!markScalarFlag(arg, scalarFlags)) {
        return undefined;
      }
      privateEvidencePath = value;
    } else if (arg === "--summary") {
      if (!markScalarFlag(arg, scalarFlags)) {
        return undefined;
      }
      summary = value;
    } else if (arg === "--valid-until") {
      if (!markScalarFlag(arg, scalarFlags)) {
        return undefined;
      }
      validUntil = value;
    } else if (arg === "--metadata") {
      const parsedMetadata = parseMetadataValue(value);
      if (!parsedMetadata) {
        return undefined;
      }
      metadata[parsedMetadata.key] = parsedMetadata.value;
    } else {
      return undefined;
    }
    index += 1;
  }

  if (!id || !title || !evidenceType || !classification || supports.length === 0 || !privateEvidencePath || !summary) {
    return undefined;
  }

  return {
    id,
    title,
    evidenceType,
    classification,
    supports,
    privateEvidencePath,
    summary,
    ...(validUntil ? { validUntil } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {})
  };
}

function markScalarFlag(flag: string, seenFlags: Set<string>): boolean {
  if (seenFlags.has(flag)) {
    return false;
  }
  seenFlags.add(flag);
  return true;
}

function parseCommaSeparatedValues(value: string): string[] {
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function parseMetadataValue(value: string): { key: string; value: string } | undefined {
  const separatorIndex = value.indexOf("=");
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    return undefined;
  }
  const key = value.slice(0, separatorIndex).trim();
  const metadataValue = value.slice(separatorIndex + 1).trim();
  return key && metadataValue ? { key, value: metadataValue } : undefined;
}

function isCliEvidenceType(value: string): value is EvidenceAddOptions["evidenceType"] {
  return CLI_EVIDENCE_TYPES.has(value as EvidenceAddOptions["evidenceType"]);
}

function isCliEvidenceAddClassification(value: string): value is EvidenceAddOptions["classification"] {
  return CLI_EVIDENCE_ADD_CLASSIFICATIONS.has(value as EvidenceAddOptions["classification"]);
}

function parseEvidenceIndexArgs(args: string[]): { fromScan?: string } | undefined {
  if (args.length === 0) {
    return {};
  }
  if (args.length === 2 && args[0] === "--from-scan" && args[1] && !args[1].startsWith("--")) {
    return { fromScan: args[1] };
  }
  return undefined;
}

function parseEvidenceReviewArgs(args: string[]): {
  evidenceId: string;
  requirementId: string;
  decision: "accepted" | "rejected" | "needs_followup";
  rationale: string;
  reviewer?: string;
  expiresAt?: string;
  privateEvidencePath?: string;
} | undefined {
  const evidenceId = args[0];
  if (!evidenceId || evidenceId.startsWith("--")) {
    return undefined;
  }

  let requirementId: string | undefined;
  let decision: "accepted" | "rejected" | "needs_followup" | undefined;
  let rationale: string | undefined;
  let reviewer: string | undefined;
  let expiresAt: string | undefined;
  let privateEvidencePath: string | undefined;

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      return undefined;
    }
    if (arg === "--requirement") {
      requirementId = value;
    } else if (arg === "--decision") {
      if (value !== "accepted" && value !== "rejected" && value !== "needs_followup") {
        return undefined;
      }
      decision = value;
    } else if (arg === "--rationale") {
      rationale = value;
    } else if (arg === "--reviewer") {
      reviewer = value;
    } else if (arg === "--expires-at") {
      expiresAt = value;
    } else if (arg === "--private-evidence") {
      privateEvidencePath = value;
    } else {
      return undefined;
    }
    index += 1;
  }

  if (!requirementId || !decision || !rationale) {
    return undefined;
  }

  return {
    evidenceId,
    requirementId,
    decision,
    rationale,
    ...(reviewer ? { reviewer } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(privateEvidencePath ? { privateEvidencePath } : {})
  };
}

function parseCloudflareEvidenceReviewArgs(args: string[]): {
  decision?: "needs_followup" | "rejected";
  rationale?: string;
  reviewer?: string;
  dryRun?: boolean;
} | undefined {
  let decision: "needs_followup" | "rejected" | undefined;
  let rationale: string | undefined;
  let reviewer: string | undefined;
  let dryRun = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      return undefined;
    }

    if (arg === "--decision") {
      if (value !== "needs_followup" && value !== "rejected") {
        return undefined;
      }
      decision = value;
    } else if (arg === "--rationale") {
      rationale = value;
    } else if (arg === "--reviewer") {
      reviewer = value;
    } else {
      return undefined;
    }
    index += 1;
  }

  return {
    ...(decision ? { decision } : {}),
    ...(rationale ? { rationale } : {}),
    ...(reviewer ? { reviewer } : {}),
    ...(dryRun ? { dryRun } : {})
  };
}

function hasAcceptedCloudflareBulkDecision(args: string[]): boolean {
  for (let index = 0; index < args.length - 1; index += 1) {
    if (args[index] === "--decision" && args[index + 1] === "accepted") {
      return true;
    }
  }
  return false;
}

function parseScanOptions(args: string[]): ScanOptions | undefined {
  if (args.length === 0) {
    return undefined;
  }

  const options: ScanOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--local") {
      options.local = true;
      continue;
    }

    if (arg === "--target") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        return undefined;
      }
      options.target = value;
      index += 1;
      continue;
    }

    if (arg === "--include" || arg === "--exclude") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        return undefined;
      }
      if (arg === "--include") {
        options.include = [...(options.include ?? []), value];
      } else {
        options.exclude = [...(options.exclude ?? []), value];
      }
      index += 1;
      continue;
    }

    if (arg === "--github" || arg === "--vercel" || arg === "--cloudflare") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        return undefined;
      }
      if (arg === "--github") {
        options.github = value;
      } else if (arg === "--vercel") {
        options.vercel = value;
      } else {
        options.cloudflare = value;
      }
      index += 1;
      continue;
    }

    if (arg === "--cloudflare-account") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        return undefined;
      }
      options.cloudflareAccount = value;
      index += 1;
      continue;
    }

    if (arg === "--cloudflare-products") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        return undefined;
      }
      const products = parseCloudflareProducts(value);
      if (!products) {
        return undefined;
      }
      options.cloudflareProducts = products;
      index += 1;
      continue;
    }

    return undefined;
  }

  if ((options.target || options.include || options.exclude) && !options.local) {
    return undefined;
  }

  if ((options.cloudflareAccount || options.cloudflareProducts) && !options.cloudflare) {
    return undefined;
  }

  return options.local || options.github || options.vercel || options.cloudflare ? options : undefined;
}

await main(process.argv);
