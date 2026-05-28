# Agent Ask Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `isms-agent ask-context` so Codex or Claude Code can answer natural-language ISMS-P readiness questions from a deterministic local context bundle without a separate LLM API key.

**Architecture:** Reuse the existing file-based workspace, latest scan loader, and conservative analyzer. Add a small ask-context pipeline: classify the question, score relevant analyzed controls and scan signals, then render JSON or Markdown without writing files.

**Tech Stack:** Node.js 22+, TypeScript, Node built-in `node:test`, existing analyzer and schemas, no new runtime dependencies.

---

## File Structure

```text
src/cli.ts
src/commands/ask-context.ts
src/commands/report.ts
src/core/workspace-data.ts
src/ask/question-classifier.ts
src/ask/relevance.ts
src/ask/context-builder.ts
src/ask/output.ts
src/schemas/ask-context.ts
test/commands/ask-context.test.ts
README.md
docs/superpowers/specs/2026-05-28-agent-ask-context-design.md
```

Responsibilities:

- `src/core/workspace-data.ts`: shared readers for `controls/*.json` and latest `scans/*.json`.
- `src/ask/question-classifier.ts`: deterministic intent classification and token extraction.
- `src/ask/relevance.ts`: deterministic control and signal scoring.
- `src/ask/context-builder.ts`: builds the structured bundle from controls, latest scan, and analyzer output.
- `src/ask/output.ts`: renders JSON and Markdown.
- `src/commands/ask-context.ts`: validates CLI options and calls the ask pipeline.
- `src/cli.ts`: wires `ask-context` into the executable command surface.

## Task 1: Shared Workspace Data Loader

**Files:**
- Create: `src/core/workspace-data.ts`
- Modify: `src/commands/report.ts`
- Test: existing `test/reports/report.test.ts`

- [ ] **Step 1: Extract the loader**

Move the existing `loadControls`, `loadLatestScan`, and JSON file listing logic from `src/commands/report.ts` into `src/core/workspace-data.ts` with exported functions:

```ts
export async function loadControls(workspaceRoot: string): Promise<ControlKnowledge[]>
export async function loadLatestScan(workspaceRoot: string): Promise<ScanResult>
```

- [ ] **Step 2: Update report generation**

Replace private loader calls in `src/commands/report.ts` with imports from `../core/workspace-data.js`.

- [ ] **Step 3: Run regression test**

Run:

```bash
npm test -- test/reports/report.test.ts
```

Expected: report behavior remains unchanged.

## Task 2: Ask Context Tests

**Files:**
- Create: `test/commands/ask-context.test.ts`
- Create: `src/schemas/ask-context.ts`
- Create: `src/commands/ask-context.ts`

- [ ] **Step 1: Write failing tests**

Add tests that expect these behaviors:

```ts
test("buildAskContext prioritizes exact control ID questions", async () => {
  const context = await buildAskContext(dir, "2.5.3 사용자 인증 상태 알려줘");
  assert.equal(context.intent, "control_status");
  assert.equal(context.relevantControls[0]?.control_id, "2.5.3");
  assert.match(context.facts.join("\n"), /2\.5\.3 사용자 인증 status is partial/);
});
```

```ts
test("buildAskContext classifies Korean evidence questions", async () => {
  const context = await buildAskContext(dir, "사용자 인증 증적은 무엇이 부족해?");
  assert.equal(context.intent, "evidence");
  assert.ok(context.answerConstraints.some((item) => item.includes("candidate evidence")));
});
```

```ts
test("renderAskContextMarkdown includes constraints and uncertainty language", async () => {
  const markdown = renderAskContextMarkdown(context);
  assert.match(markdown, /# Ask Context/);
  assert.match(markdown, /candidate evidence/i);
  assert.match(markdown, /Do not claim certification readiness/i);
});
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
npm test -- test/commands/ask-context.test.ts
```

Expected: build fails because ask-context modules do not exist.

## Task 3: Ask Context Implementation

**Files:**
- Create: `src/schemas/ask-context.ts`
- Create: `src/ask/question-classifier.ts`
- Create: `src/ask/relevance.ts`
- Create: `src/ask/context-builder.ts`
- Create: `src/ask/output.ts`
- Create: `src/commands/ask-context.ts`

- [ ] **Step 1: Define schema**

Create `AskContextBundle`, `AskIntent`, and `RelevantControlContext` interfaces. Keep schema version fixed at `1`.

- [ ] **Step 2: Implement classifier**

Implement deterministic classification:

- exact control ID -> `control_status`
- words including `증적`, `evidence`, `proof` -> `evidence`
- words including `backlog`, `next`, `먼저`, `이번 주`, `이번달` -> `backlog`
- words including `gap`, `missing`, `부족`, `위험`, `리스크` -> `gap_summary`
- words including `source`, `출처`, `근거`, `trace` -> `source_trace`
- fallback -> `general`

- [ ] **Step 3: Implement relevance scoring**

Score each analyzed control by exact ID, title, model terms, analysis terms, and intent fallback. Cap controls to five and signals to ten.

- [ ] **Step 4: Build context bundle**

Load controls and latest scan, call `analyzeControls`, score relevance, select signals, emit facts and answer constraints.

- [ ] **Step 5: Render output**

JSON output uses `JSON.stringify(bundle, null, 2) + "\n"`. Markdown output includes question, intent, relevant controls, relevant signals, facts, report references, and answer constraints.

- [ ] **Step 6: Run tests**

Run:

```bash
npm test -- test/commands/ask-context.test.ts
```

Expected: ask-context tests pass.

## Task 4: CLI and Docs

**Files:**
- Modify: `src/cli.ts`
- Modify: `README.md`
- Test: `test/commands/ask-context.test.ts`

- [ ] **Step 1: Wire CLI command**

Add:

```bash
isms-agent ask-context <question> [--json] [--markdown]
```

Question tokens before flags should be joined with spaces. Quoted questions continue to work as a single argument.

- [ ] **Step 2: Update README**

Document the Option B flow:

```bash
isms-agent ask-context "2.5.3 사용자 인증 상태 알려줘"
isms-agent ask-context "이번 주 먼저 처리할 항목은?" --markdown
```

Explain that the command provides context to Codex or Claude Code and does not need a separate LLM API key.

- [ ] **Step 3: Verify usage behavior**

Run:

```bash
npm test
npm run check
git diff --check
```

Expected: all commands exit 0.

## Self-Review

- Spec coverage: command contract, schema, deterministic classifier, relevance rules, safety rules, and tests are all mapped to tasks.
- Placeholder scan: no placeholders remain.
- Type consistency: file names, function names, command name, and schema fields match the design.
