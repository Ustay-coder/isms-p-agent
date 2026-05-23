#!/usr/bin/env node
import { initWorkspace } from "./commands/init.js";

async function main(argv: string[]): Promise<void> {
  const command = argv[2];
  const args = argv.slice(3);

  if (command === "init" && args.length === 0) {
    await initWorkspace(process.cwd());
    return;
  }

  console.error("Usage: isms-agent init");
  process.exitCode = 1;
}

await main(process.argv);
