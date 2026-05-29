#!/usr/bin/env node
import { resolve } from "node:path";
import { parseAskContextArgs, runAskContext } from "./commands/ask-context.js";
import { CLOUDFLARE_BULK_ACCEPTED_ERROR, exportPublicEvidence, indexEvidenceFromScan, reviewCloudflareEvidence, reviewEvidence, validateEvidence } from "./commands/evidence.js";
import { initWorkspace } from "./commands/init.js";
import { ingestSource } from "./commands/ingest.js";
import { generatePack, installPack, parsePackGenerateArgs, validatePack } from "./commands/pack.js";
import { generateReports } from "./commands/report.js";
import { scanLocal, scanWorkspace, type ScanOptions } from "./commands/scan.js";
import { parseCloudflareProducts } from "./connectors/cloudflare-products.js";

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

  console.error("Usage: isms-agent init");
  console.error("Usage: isms-agent ingest <raw-file>");
  console.error("Usage: isms-agent scan --local [--target path] [--include paths] [--exclude paths] [--github owner/repo] [--vercel project] [--cloudflare zone-or-zone-id] [--cloudflare-account account-id] [--cloudflare-products zone,access,waf,dns,workers,r2,hyperdrive,api-gateway]");
  console.error("Usage: isms-agent report [--public]");
  console.error("Usage: isms-agent evidence index [--from-scan scans/file.json]");
  console.error("Usage: isms-agent evidence review <evidence-id> --requirement <id> --decision <accepted|rejected|needs_followup> --rationale <text> [--reviewer <name>] [--expires-at <iso>]");
  console.error("Usage: isms-agent evidence review-cloudflare [--decision needs_followup|rejected] [--rationale <text>] [--reviewer <name>] [--dry-run]");
  console.error("Usage: isms-agent evidence export-public");
  console.error("Usage: isms-agent evidence validate [--public]");
  console.error("Usage: isms-agent pack install [pack-dir] [--overwrite]");
  console.error("Usage: isms-agent pack generate --openkb <openkb-dir> --pack <pack-dir> --controls <ids> [--version <version>]");
  console.error("Usage: isms-agent pack validate [pack-dir]");
  console.error("Usage: isms-agent ask-context <question> [--json] [--markdown]");
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
    } else {
      return undefined;
    }
    index += 1;
  }

  if (!requirementId || !decision || !rationale) {
    return undefined;
  }

  return { evidenceId, requirementId, decision, rationale, ...(reviewer ? { reviewer } : {}), ...(expiresAt ? { expiresAt } : {}) };
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
