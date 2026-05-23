#!/usr/bin/env node
import { initWorkspace } from "./commands/init.js";

async function main(argv: string[]): Promise<void> {
  const command = argv[2];

  if (command === "init") {
    await initWorkspace(process.cwd());
    return;
  }

  console.error("Usage: isms-agent init");
  process.exitCode = 1;
}

await main(process.argv);
