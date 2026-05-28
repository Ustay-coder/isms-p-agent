# ISMS-P Agent MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CLI-first ISMS-P readiness assistant that initializes a local workspace, maintains a traceable ISMS-P knowledge model, scans GitHub/Vercel/Cloudflare/repo/docs metadata in read-only mode, and generates backlog, control gap, and evidence-map reports.

**Architecture:** Implement the MVP as a local TypeScript CLI using file-based storage. Keep the wiki in Markdown, controls and scan outputs in JSON, and generated reports in Markdown. Build the system in vertical slices: foundation, ingest, local scan, cloud connectors, analyzer, reports, then hardening.

**Tech Stack:** Node.js 22+ runtime, TypeScript, Node built-in `node:test`, Node built-in `fs`, `path`, `crypto`, and native `fetch`; no database in the MVP.

---

## Scope Split

The spec covers several subsystems. Implement them as separate milestones so each can be tested and committed independently.

1. Foundation CLI and workspace contract
2. ISMS-P source ingest and control model
3. Local repo and operating-document scanner
4. GitHub, Vercel, and Cloudflare read-only connectors
5. Applicability and gap analyzer
6. Markdown report generator
7. Safety, provenance, and release hardening

## File Structure

Create this structure over the milestones:

```text
package.json
tsconfig.json
src/cli.ts
src/commands/init.ts
src/commands/ingest.ts
src/commands/scan.ts
src/commands/report.ts
src/core/workspace.ts
src/core/log.ts
src/core/json.ts
src/core/provenance.ts
src/schemas/control.ts
src/schemas/scan.ts
src/schemas/analysis.ts
src/ingest/markdown.ts
src/ingest/source-index.ts
src/scanners/local-repo.ts
src/scanners/local-docs.ts
src/connectors/github.ts
src/connectors/vercel.ts
src/connectors/cloudflare.ts
src/analyzer/applicability.ts
src/analyzer/gap.ts
src/reports/backlog.ts
src/reports/control-gap-report.ts
src/reports/evidence-map.ts
src/reports/markdown.ts
test/commands/init.test.ts
test/commands/ingest.test.ts
test/scanners/local-repo.test.ts
test/scanners/local-docs.test.ts
test/connectors/github.test.ts
test/connectors/vercel.test.ts
test/connectors/cloudflare.test.ts
test/analyzer/gap.test.ts
test/reports/report.test.ts
docs/superpowers/specs/2026-05-23-isms-p-agent-mvp-design.md
docs/superpowers/plans/2026-05-23-isms-p-agent-mvp-implementation.md
```

Runtime workspaces created by the CLI contain:

```text
raw/
wiki/
controls/
project/
connectors/
scans/
reports/
AGENTS.md
log.md
isms-agent.config.json
```

## Milestone 1: Foundation CLI and Workspace Contract

### Task 1: Create the TypeScript CLI skeleton

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/cli.ts`
- Create: `src/commands/init.ts`
- Create: `src/core/workspace.ts`
- Create: `src/core/log.ts`
- Test: `test/commands/init.test.ts`

- [ ] **Step 1: Write the failing init test**

Create `test/commands/init.test.ts`:

```ts
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { initWorkspace } from "../../src/commands/init";

test("initWorkspace creates the ISMS-P workspace contract", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isms-agent-init-"));
  try {
    await initWorkspace(dir);

    for (const name of ["raw", "wiki", "controls", "project", "connectors", "scans", "reports"]) {
      assert.equal((await stat(join(dir, name))).isDirectory(), true);
    }

    const agents = await readFile(join(dir, "AGENTS.md"), "utf8");
    assert.match(agents, /raw source/i);
    assert.match(agents, /read-only/i);
    assert.match(agents, /control satisfaction/i);

    const log = await readFile(join(dir, "log.md"), "utf8");
    assert.match(log, /^# ISMS-P Agent Log/m);

    const config = JSON.parse(await readFile(join(dir, "isms-agent.config.json"), "utf8"));
    assert.equal(config.schemaVersion, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Add project metadata and scripts**

Create `package.json`:

```json
{
  "name": "isms-agent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "isms-agent": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "npm run build && node --test dist/test/**/*.test.js",
    "check": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.9.0"
  },
  "engines": {
    "node": ">=22"
  }
}
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": ".",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 3: Run the failing test**

Run:

```bash
npm install
npm test -- test/commands/init.test.ts
```

Expected: TypeScript build fails because `src/commands/init` does not exist.

- [ ] **Step 4: Implement workspace creation**

Create `src/core/log.ts`:

```ts
export function logEntry(kind: string, message: string, now = new Date()): string {
  return `## [${now.toISOString()}] ${kind} | ${message}\n`;
}
```

Create `src/core/workspace.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const WORKSPACE_DIRECTORIES = [
  "raw",
  "wiki",
  "controls",
  "project",
  "connectors",
  "scans",
  "reports"
] as const;

export async function ensureWorkspaceDirectories(root: string): Promise<void> {
  for (const directory of WORKSPACE_DIRECTORIES) {
    await mkdir(join(root, directory), { recursive: true });
  }
}

export async function writeTextIfMissing(path: string, content: string): Promise<void> {
  try {
    await writeFile(path, content, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }
}
```

Create `src/commands/init.ts`:

```ts
import { join } from "node:path";
import { ensureWorkspaceDirectories, writeTextIfMissing } from "../core/workspace";

const AGENTS_TEMPLATE = `# AGENTS.md

## ISMS-P Agent Operating Rules

- Treat raw source files as immutable. Do not edit files under raw/.
- Do not treat evidence existence as control satisfaction.
- Do not treat draft policy text as operational evidence.
- Keep GitHub, Vercel, and Cloudflare operations read-only in the MVP.
- Mark every judgment as observed, document-backed, inferred, or needs_confirmation.
- Do not collect secrets, customer records, or personal information.
- Preserve source references for wiki, control, scan, and report outputs.
- Surface real gaps. Do not hide gaps behind alternative evidence.
`;

const CONFIG_TEMPLATE = {
  schemaVersion: 1,
  workspaceKind: "isms-p-agent",
  createdBy: "isms-agent init",
  reportFormats: ["markdown"]
};

export async function initWorkspace(root: string): Promise<void> {
  await ensureWorkspaceDirectories(root);
  await writeTextIfMissing(join(root, "AGENTS.md"), AGENTS_TEMPLATE);
  await writeTextIfMissing(join(root, "log.md"), "# ISMS-P Agent Log\n");
  await writeTextIfMissing(
    join(root, "isms-agent.config.json"),
    `${JSON.stringify(CONFIG_TEMPLATE, null, 2)}\n`
  );
}
```

Create `src/cli.ts`:

```ts
#!/usr/bin/env node
import { initWorkspace } from "./commands/init";

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
```

- [ ] **Step 5: Run tests and checks**

Run:

```bash
npm test
npm run check
```

Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json src test
git commit -m "feat: add CLI workspace initialization"
```

## Milestone 2: ISMS-P Source Ingest and Control Model

### Task 2: Define the control schema and Markdown ingest

**Files:**
- Create: `src/schemas/control.ts`
- Create: `src/core/json.ts`
- Create: `src/core/provenance.ts`
- Create: `src/ingest/markdown.ts`
- Create: `src/ingest/source-index.ts`
- Create: `src/commands/ingest.ts`
- Modify: `src/cli.ts`
- Test: `test/commands/ingest.test.ts`

- [ ] **Step 1: Add tests for Markdown source ingest**

Test behavior:

- reads a Markdown source under `raw/`,
- computes a SHA-256 hash,
- writes a source index under `wiki/sources/`,
- writes at least one control JSON file under `controls/`,
- appends an ingest entry to `log.md`,
- rejects source paths outside `raw/`.

- [ ] **Step 2: Implement schema types**

Define exact unions:

```ts
export type AutomationPotential = "none" | "partial" | "high";

export interface SourceRef {
  sourcePath: string;
  sha256: string;
  excerpt?: string;
}

export interface ControlKnowledge {
  control_id: string;
  title: string;
  domain: string;
  category: string;
  requirement: string;
  intent: string;
  applicability_questions: string[];
  observable_signals: string[];
  required_operating_practices: string[];
  required_evidence: string[];
  common_defects: string[];
  automation_potential: AutomationPotential;
  human_review_required: boolean;
  source_refs: SourceRef[];
}
```

- [ ] **Step 3: Implement minimal deterministic ingest**

For MVP planning, do not call an LLM from code. Parse Markdown headings that match:

```text
## 2.5.3 사용자 인증
```

Map the heading to a `ControlKnowledge` record with source refs and conservative empty arrays for fields not present in the source.

- [ ] **Step 4: Add `isms-agent ingest <raw-file>` CLI route**

The command must only accept paths inside `raw/`.

- [ ] **Step 5: Run tests and commit**

```bash
npm test
git add src test
git commit -m "feat: add source ingest and control model"
```

## Milestone 3: Local Repo and Operating-Document Scanner

### Task 3: Scan local repo and documents without collecting sensitive values

**Files:**
- Create: `src/schemas/scan.ts`
- Create: `src/scanners/local-repo.ts`
- Create: `src/scanners/local-docs.ts`
- Create: `src/commands/scan.ts`
- Modify: `src/cli.ts`
- Test: `test/scanners/local-repo.test.ts`
- Test: `test/scanners/local-docs.test.ts`

- [ ] **Step 1: Write tests for safe local scanning**

Test behavior:

- detects dependency manifests such as `package.json`,
- detects CI files under `.github/workflows/`,
- detects auth/session/logging keyword signals without storing source contents,
- records environment variable names but not values,
- indexes document filenames and headings,
- writes JSON scan output under `scans/`.

- [ ] **Step 2: Define scan schema**

Use these types:

```ts
export type SignalBasis = "observed" | "document-backed" | "inferred" | "needs_confirmation";

export interface ScanSignal {
  id: string;
  source: "local-repo" | "local-docs" | "github" | "vercel" | "cloudflare";
  basis: SignalBasis;
  summary: string;
  paths: string[];
  metadata: Record<string, string | number | boolean | string[]>;
}

export interface ScanResult {
  schemaVersion: 1;
  generatedAt: string;
  signals: ScanSignal[];
}
```

- [ ] **Step 3: Implement local scanners**

The scanners should emit metadata and paths only. They must not copy file bodies into `scans/`.

- [ ] **Step 4: Add `isms-agent scan --local`**

The command writes `scans/local-<timestamp>.json`.

- [ ] **Step 5: Run tests and commit**

```bash
npm test
git add src test
git commit -m "feat: add safe local scanners"
```

## Milestone 4: GitHub, Vercel, and Cloudflare Read-only Connectors

### Task 4: Add connector interfaces and metadata collectors

**Files:**
- Create: `src/connectors/github.ts`
- Create: `src/connectors/vercel.ts`
- Create: `src/connectors/cloudflare.ts`
- Modify: `src/commands/scan.ts`
- Test: `test/connectors/github.test.ts`
- Test: `test/connectors/vercel.test.ts`
- Test: `test/connectors/cloudflare.test.ts`

- [ ] **Step 1: Write tests with mocked `fetch`**

Each connector test must assert:

- token value is sent only as an authorization header,
- token value is never returned in `ScanSignal.metadata`,
- only metadata needed for diagnosis is emitted,
- API errors become `needs_confirmation` signals instead of crashing the full scan.

- [ ] **Step 2: Implement a shared connector pattern**

Each connector exports one function:

```ts
export async function scanGitHub(input: GitHubInput, fetchImpl?: typeof fetch): Promise<ScanSignal[]>;
export async function scanVercel(input: VercelInput, fetchImpl?: typeof fetch): Promise<ScanSignal[]>;
export async function scanCloudflare(input: CloudflareInput, fetchImpl?: typeof fetch): Promise<ScanSignal[]>;
```

- [ ] **Step 3: Collect metadata only**

GitHub first signals:

- branch protection presence,
- Actions workflow presence,
- Dependabot config presence,
- CODEOWNERS presence,
- repository visibility.

Vercel first signals:

- project exists,
- production domain exists,
- latest deployment status,
- environment variable names or counts only.

Cloudflare first signals:

- zone exists,
- TLS mode,
- WAF availability,
- Access app count,
- DNS record metadata.

- [ ] **Step 4: Add scan flags**

Add:

```bash
isms-agent scan --github owner/repo --vercel project --cloudflare zone
```

Tokens come from:

```text
GITHUB_TOKEN
VERCEL_TOKEN
CLOUDFLARE_API_TOKEN
```

- [ ] **Step 5: Run tests and commit**

```bash
npm test
git add src test
git commit -m "feat: add read-only SaaS metadata connectors"
```

## Milestone 5: Applicability and Gap Analyzer

### Task 5: Convert controls and scan signals into judgments

**Files:**
- Create: `src/schemas/analysis.ts`
- Create: `src/analyzer/applicability.ts`
- Create: `src/analyzer/gap.ts`
- Test: `test/analyzer/gap.test.ts`

- [ ] **Step 1: Write analyzer tests**

Test behavior:

- a control with matching observed technical signals can be `partial`,
- missing operating-practice evidence prevents `satisfied`,
- missing inputs produce `needs_confirmation`,
- irrelevant controls can be `not_applicable` only when applicability questions are answered or clearly unsupported by inputs,
- judgment basis is preserved.

- [ ] **Step 2: Define analysis schema**

Use the exact status values from the spec:

```ts
export type ControlStatus = "satisfied" | "partial" | "gap" | "not_applicable" | "needs_confirmation";
export type Confidence = "low" | "medium" | "high";
export type JudgmentBasis = "observed" | "document-backed" | "inferred" | "user-confirmed";
```

- [ ] **Step 3: Implement conservative gap rules**

Rules:

- Never return `satisfied` unless both technical signals and operating-practice evidence exist.
- Return `partial` when technical configuration exists but operating evidence is missing.
- Return `gap` when required technical or operating signals are absent.
- Return `needs_confirmation` when scanner coverage is insufficient.
- Return `not_applicable` only with explicit applicability support.

- [ ] **Step 4: Run tests and commit**

```bash
npm test
git add src test
git commit -m "feat: add conservative control gap analyzer"
```

## Milestone 6: Markdown Report Generator

### Task 6: Generate backlog, control gap report, and evidence map

**Files:**
- Create: `src/reports/markdown.ts`
- Create: `src/reports/backlog.ts`
- Create: `src/reports/control-gap-report.ts`
- Create: `src/reports/evidence-map.ts`
- Create: `src/commands/report.ts`
- Modify: `src/cli.ts`
- Test: `test/reports/report.test.ts`

- [ ] **Step 1: Write report tests**

Test behavior:

- writes `reports/backlog.md`,
- writes `reports/control-gap-report.md`,
- writes `reports/evidence-map.md`,
- backlog groups tasks by `this week`, `this month`, and `before certification readiness review`,
- report text labels candidate evidence as candidate evidence, not final audit evidence,
- each control includes status, missing items, recommended actions, confidence, basis, and source refs.

- [ ] **Step 2: Implement Markdown rendering**

Reports must be deterministic so snapshots or string assertions are stable.

- [ ] **Step 3: Add `isms-agent report`**

The command reads latest scan and control files, runs the analyzer, and writes the three Markdown reports.

- [ ] **Step 4: Run tests and commit**

```bash
npm test
git add src test
git commit -m "feat: generate ISMS-P readiness reports"
```

## Milestone 7: Safety, Provenance, and Release Hardening

### Task 7: Add final guardrails and documentation

**Files:**
- Create: `README.md`
- Create: `docs/security-model.md`
- Modify: `src/commands/scan.ts`
- Modify: `src/commands/ingest.ts`
- Modify: `src/reports/evidence-map.ts`

- [ ] **Step 1: Add safety tests**

Add tests that confirm:

- source paths outside `raw/` are rejected,
- scan output does not contain known secret test values,
- connector failure creates reportable uncertainty,
- generated evidence map calls evidence "candidate evidence".

- [ ] **Step 2: Document the security model**

`docs/security-model.md` must state:

- read-only connector policy,
- no secret storage,
- no customer or personal data collection,
- source provenance requirements,
- human approval boundaries.

- [ ] **Step 3: Document the MVP workflow**

`README.md` must include:

- the project purpose: an open source, CLI-first ISMS-P readiness assistant for startup SaaS teams,
- the implementation approach: Markdown wiki, JSON control model, read-only scanners, conservative analyzer, Markdown reports,
- the overall architecture flow from raw sources and SaaS metadata to backlog, control gap report, and evidence map,

```bash
npm install
npm run build
npm test
npm link
isms-agent init
isms-agent ingest raw/example.md
isms-agent scan --local
isms-agent report
```

- [ ] **Step 4: Run final verification**

```bash
npm test
npm run check
git diff --check
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add README.md docs src test
git commit -m "docs: document MVP workflow and safety model"
```

## Spec Coverage Check

- Purpose and target user: covered by README, report wording, and conservative backlog output.
- Non-goals: covered by read-only connectors, no mutation commands, no final audit evidence package.
- Product principles: covered by AGENTS.md, analyzer rules, report basis fields, evidence-map wording.
- First supported stack: covered by GitHub, Vercel, Cloudflare connectors plus local repo/docs scanner.
- Information architecture: covered by `isms-agent init`.
- Knowledge model: covered by `src/schemas/control.ts` and ingest output.
- CLI commands: covered by `init`, `ingest`, `scan`, and `report`.
- Output model: covered by the three Markdown reports.
- Failure modes: covered by analyzer rules, tests, and security documentation.
- Acceptance criteria: covered by Milestones 1 through 7.

## Execution Order

Implement in order. Do not start cloud connectors before Milestones 1 through 3 pass. Do not start reports before the analyzer schema exists. Do not add HTML output, hosted UI, GitHub Action, HWP parsing, or evidence vault behavior in this MVP implementation plan.
