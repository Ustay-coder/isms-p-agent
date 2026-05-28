#!/usr/bin/env node
import { initWorkspace } from "./commands/init.js";
import { ingestSource } from "./commands/ingest.js";

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

  console.error("Usage: isms-agent init");
  console.error("Usage: isms-agent ingest <raw-file>");
  process.exitCode = 1;
}

await main(process.argv);
