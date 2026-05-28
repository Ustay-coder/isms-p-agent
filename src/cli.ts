#!/usr/bin/env node
import { resolve } from "node:path";
import { parseAskContextArgs, runAskContext } from "./commands/ask-context.js";
import { initWorkspace } from "./commands/init.js";
import { ingestSource } from "./commands/ingest.js";
import { validatePack } from "./commands/pack.js";
import { generateReports } from "./commands/report.js";
import { scanLocal, scanWorkspace, type ScanOptions } from "./commands/scan.js";

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

  if (command === "scan" && args.length === 1 && args[0] === "--local") {
    const result = await scanLocal(process.cwd());
    console.log(result.outputPath);
    return;
  }

  if (command === "scan") {
    const options = parseScanOptions(args);
    if (options) {
      const result = await scanWorkspace(process.cwd(), options);
      console.log(result.outputPath);
      return;
    }
  }

  if (command === "report" && args.length === 0) {
    const result = await generateReports(process.cwd());
    console.log(result.outputPaths.backlog);
    console.log(result.outputPaths.controlGapReport);
    console.log(result.outputPaths.evidenceMap);
    return;
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
  console.error("Usage: isms-agent scan --local [--github owner/repo] [--vercel project] [--cloudflare zone-or-zone-id]");
  console.error("Usage: isms-agent report");
  console.error("Usage: isms-agent pack validate [pack-dir]");
  console.error("Usage: isms-agent ask-context <question> [--json] [--markdown]");
  process.exitCode = 1;
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

    return undefined;
  }

  return options.local || options.github || options.vercel || options.cloudflare ? options : undefined;
}

await main(process.argv);
