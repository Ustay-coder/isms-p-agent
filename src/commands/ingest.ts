import { appendFile, readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { logEntry } from "../core/log.js";
import { writeJson } from "../core/json.js";
import { assertInsideDirectory, assertRealPathInsideDirectory, sha256File, workspaceRelativePath } from "../core/provenance.js";
import { parseMarkdownControls, safeControlFilename } from "../ingest/markdown.js";
import { writeSourceIndex } from "../ingest/source-index.js";
import type { ControlKnowledge, SourceRef } from "../schemas/control.js";

export interface IngestResult {
  controls: ControlKnowledge[];
  sourceRef: SourceRef;
}

export async function ingestSource(workspaceRoot: string, rawFile: string): Promise<IngestResult> {
  const rawRoot = join(workspaceRoot, "raw");
  const sourcePath = resolve(workspaceRoot, rawFile);
  assertInsideDirectory(rawRoot, sourcePath, "Source must be inside raw/");
  await assertRealPathInsideDirectory(rawRoot, sourcePath, "Source must be inside raw/");

  if (![".md", ".markdown"].includes(extname(sourcePath).toLowerCase())) {
    throw new Error("Source must be a Markdown file");
  }

  const content = await readFile(sourcePath, "utf8");
  const sourceRef: SourceRef = {
    sourcePath: workspaceRelativePath(workspaceRoot, sourcePath),
    sha256: await sha256File(sourcePath)
  };
  const controls = parseMarkdownControls(content, sourceRef);

  for (const control of controls) {
    await writeJson(join(workspaceRoot, "controls", safeControlFilename(control.control_id)), control);
  }

  await writeSourceIndex(workspaceRoot, sourceRef);
  await appendFile(
    join(workspaceRoot, "log.md"),
    logEntry("ingest", `${sourceRef.sourcePath} -> ${controls.length} controls`)
  );

  return { controls, sourceRef };
}
