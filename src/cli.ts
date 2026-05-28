#!/usr/bin/env node
import { initWorkspace } from "./commands/init.js";
import { ingestSource } from "./commands/ingest.js";
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

  console.error("Usage: isms-agent init");
  console.error("Usage: isms-agent ingest <raw-file>");
  console.error("Usage: isms-agent scan --local [--github owner/repo] [--vercel project] [--cloudflare zone-or-zone-id]");
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
