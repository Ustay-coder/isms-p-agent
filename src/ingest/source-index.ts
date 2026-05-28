import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SourceRef } from "../schemas/control.js";

function safeSourceIndexPath(sourcePath: string): string {
  return `${sourcePath.replace(/[^0-9A-Za-z가-힣._-]/g, "_")}.md`;
}

export async function writeSourceIndex(workspaceRoot: string, sourceRef: SourceRef): Promise<string> {
  const outputDir = join(workspaceRoot, "wiki", "sources");
  const outputPath = join(outputDir, safeSourceIndexPath(sourceRef.sourcePath));
  const content = `# Source Index: ${sourceRef.sourcePath}

- Source: ${sourceRef.sourcePath}
- SHA-256: ${sourceRef.sha256}
`;

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, content);
  return outputPath;
}
