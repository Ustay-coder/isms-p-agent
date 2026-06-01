# Control Pack Contribution Guide

This guide explains how to improve public ISMS-P control packs without turning scanner output or draft text into false assurance.

## Source of Truth

`packs/isms-p-core-v0` is curated from OpenKB material. Contributions should preserve OpenKB as the source of truth unless a maintainer explicitly accepts a new source profile.

Use these source layers in this order:

1. `compiled/controls` for control identity and status.
2. `compiled/citations` for source claims.
3. `compiled/evidence` for evidence requirements.
4. public `wiki` notes for reviewed explanatory context.
5. `raw/legal/*` only as a source-profile cross-check, not as a direct public `source_refs` replacement.

## Required Control Fields

Every control must keep the core fields reviewable:

- `control_id`, `title`, `domain`, `category`, and `requirement`
- `intent`
- `applicability_questions`
- `observable_signals`
- `required_operating_practices`
- `required_evidence`
- `common_defects`
- `automation_potential`
- `human_review_required`
- `source_refs`
- `requirements`
- `pack`

If a field cannot be supported by source material, leave the gap visible and mark the control or generated pack as requiring human review.

## Source Reference Rules

Each `source_refs` entry must include:

- `sourcePath`: public pack source path or OpenKB compiled/wiki path,
- `sha256`: stable hash when available, or `openkb-managed` for current OpenKB-managed compiled sources,
- `excerpt`: short source cue that helps reviewers locate the basis.

Do not use private local filesystem paths, private Obsidian paths, screenshots, access exports, or real service evidence as public `source_refs`.

## Requirement Rules

Each `requirements[]` item must:

- use a stable `requirement_id`,
- reference the same `control_id`,
- set `kind` to one of the schema values,
- list expected `evidence_types`,
- keep its own `source_refs`,
- avoid claiming satisfaction from a scanner hit.

Good requirement wording describes what a control owner must verify. It should not say that a repo pattern, Cloudflare setting, GitHub setting, or document name proves the control is satisfied.

## Judgment Basis

Reports and reviews should keep judgment basis explicit:

- `observed`: directly seen in local files or read-only metadata,
- `document-backed`: supported by a provided document,
- `inferred`: plausible from context but not directly proven,
- `needs_confirmation`: not enough reliable evidence.

When uncertain, use `needs_confirmation`. Do not hide a real gap behind adjacent evidence.

## Deleted or Residual-Risk Controls

If a source marks a control as deleted or residual-risk relevant, model that explicitly. Do not silently remove it from a pack if users still need to understand why it is not analyzed as a normal active control.

## Validation

Run:

```bash
npm run build
ismsp pack validate packs/isms-p-core-v0
npm test -- --test-name-pattern pack
```

Then run the full gate before opening a PR:

```bash
npm run check
npm test
```

## Korean Note

통제항목 기여는 "그럴듯한 설명"이 아니라 출처가 추적 가능한 개선이어야 합니다. 스캐너 결과는 후보 증적일 뿐이며, 통제 충족 판단은 사람의 검토와 운영 증적 확인을 필요로 합니다.
