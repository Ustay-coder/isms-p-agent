#!/usr/bin/env node
import { initWorkspace } from "./commands/init.js";
import { ingestSource } from "./commands/ingest.js";
import { scanLocal } from "./commands/scan.js";

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

  console.error("Usage: isms-agent init");
  console.error("Usage: isms-agent ingest <raw-file>");
  console.error("Usage: isms-agent scan --local");
  process.exitCode = 1;
}

await main(process.argv);
