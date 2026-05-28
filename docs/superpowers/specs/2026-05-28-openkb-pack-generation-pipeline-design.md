# OpenKB Pack Generation Pipeline Design

Date: 2026-05-28

## 1. Decision

The next major capability should generate draft Control Knowledge Pack files from OpenKB compiled layers, then require human review before any generated control is treated as curated pack content.

The generator must preserve the Source of Truth decision from Control Knowledge Pack v0:

1. Direct pack sources are OpenKB `compiled/controls`, `compiled/citations`, `compiled/evidence`, and public `wiki` notes.
2. `raw/legal/*` profile rows are not direct pack sources. They are cross-check inputs only because their numbering can differ from compiled OpenKB control IDs.
3. Private overlays, service-specific paths, customer data, and credential-like values must not enter public pack outputs.

## 2. Purpose

Manual high-quality control authoring worked for the first three controls, but it will not scale to dozens of controls.

The pipeline should:

- read normalized OpenKB compiled data,
- produce deterministic draft pack JSON,
- preserve source lineage,
- flag deleted, merged, or conflicting controls,
- require human review before publishing,
- run `isms-agent pack validate` on every generated pack.

The pipeline should not let an AI agent invent control IDs, titles, statuses, evidence requirements, or source references when OpenKB already has those facts.

## 3. Proposed User Flow

```bash
isms-agent pack generate \
  --openkb /path/to/09_보안_ISMS-P_openkb \
  --pack packs/isms-p-core-v1 \
  --controls ISMS-P-2.5.3,ISMS-P-2.10.2

isms-agent pack validate packs/isms-p-core-v1
```

Expected flow:

1. The maintainer points the CLI at a local OpenKB root.
2. The generator reads only approved compiled/wiki inputs.
3. The generator writes draft pack files under `packs/<pack-name>/`.
4. Every generated control starts with `pack.review_status: "needs_human_review"`.
5. A reviewer edits or approves generated controls.
6. `isms-agent pack validate` gates the pack before PR.

## 4. Inputs

Required OpenKB inputs:

```text
compiled/controls/annex_7_2_mapping.jsonl
compiled/citations/source_claims.jsonl
compiled/evidence/evidence_requirements.jsonl
wiki/controls/**/<control-id>_*.md
```

Optional cross-check inputs:

```text
raw/legal/*.jsonl
compiled/controls/annex_7_3_mapping.jsonl
compiled/controls/canonical_controls.jsonl
```

The optional inputs may influence warnings and `knownSourceProfileConflicts`, but they must not become direct `source_refs` in public control JSON.

## 5. Outputs

The generator writes:

```text
packs/<pack-name>/
  pack.json
  sources/
    source-manifest.json
  controls/
    <control-id>.json
```

`pack.json` contains:

- pack name and version,
- `sourceOfTruth: "openkb"`,
- selected control IDs,
- control count,
- review status,
- public safety metadata.

`source-manifest.json` contains:

- direct OpenKB compiled/wiki source list,
- official freshness reference if available,
- `sourceProfileReferences` for raw/legal cross-checks,
- `knownSourceProfileConflicts` for numbering conflicts,
- `privateOverlaysIncluded: false`.

Each generated control contains:

- existing `ControlKnowledge` runtime fields,
- `source_refs` pointing only to compiled/wiki sources,
- `pack.source_of_truth: "openkb"`,
- `pack.review_status: "needs_human_review"`,
- `pack.source_confidence` derived from OpenKB citation confidence.

## 6. Generation Rules

### Control Identity

The generator must take `control_id`, title, domain, status, and source pages from OpenKB compiled rows. It must not infer or rename IDs from raw legal rows.

### Effective Status

Rules:

- OpenKB `status: "유지"` becomes `pack.effective_status: "active"`.
- OpenKB `status: "삭제"` becomes `pack.effective_status: "deleted_residual_risk"`.
- Merged controls must record the target control in pack metadata before they are emitted.
- Unknown statuses fail generation unless `--allow-unknown-status` is explicitly provided for draft diagnostics.

### Source References

Allowed direct source refs:

- `compiled/controls/*.jsonl`
- `compiled/citations/*.jsonl`
- `compiled/evidence/*.jsonl`
- `wiki/controls/**/*.md`

Rejected direct source refs:

- `raw/legal/*`
- `overlays/*`
- absolute local paths,
- service-specific paths such as `apps/evaluation`,
- credential-like strings.

### Draft Field Quality

The generator may seed analyzer-facing fields from OpenKB evidence requirements and wiki summaries:

- `requirement`
- `intent`
- `observable_signals`
- `required_operating_practices`
- `required_evidence`
- `common_defects`

Any field that is not directly grounded in OpenKB should be conservative and marked for human review. The generator should prefer sparse but traceable output over detailed but invented content.

## 7. Human Review Gate

Generated packs are not curated packs until reviewed.

The review gate should track:

- generated timestamp,
- generator version,
- OpenKB source paths,
- source confidence,
- reviewer identity or review note,
- changed fields after generation,
- unresolved warnings.

MVP storage can be JSON fields inside `pack.json`, `source-manifest.json`, and control `pack` metadata. A later version can add a richer review registry.

## 8. Validator Integration

The generator must call or instruct users to run:

```bash
isms-agent pack validate packs/<pack-name>
```

The validator remains the public-pack safety gate. The generator should not duplicate every validator rule, but it should avoid producing known-invalid output.

Additional validator rules likely needed for generated packs:

- generated controls must have a matching `source_claim_id` or citation reference,
- deleted controls must include residual-risk wording,
- every selected control must appear in `pack.json.controls`,
- `source-manifest.json` must include all compiled files used by any control.

## 9. Testing Strategy

Use fixture OpenKB roots under `test/fixtures/openkb/`.

Test cases:

- generate one active control from compiled mapping and citation rows,
- generate one deleted residual-risk control,
- reject direct `raw/legal` source refs,
- record raw/legal numbering conflicts in `knownSourceProfileConflicts`,
- fail clearly when required compiled files are missing,
- produce deterministic output across repeated runs,
- pass `validatePack()` on generated output.

## 10. Non-Goals

This design does not require:

- remote OpenKB downloads,
- OCR execution,
- official law lookup,
- LLM API calls,
- final audit evidence creation,
- automatic certification readiness claims,
- full all-control generation in the first implementation PR.

## 11. First Implementation Slice

The first implementation PR should build the smallest useful generator:

1. Add fixture OpenKB files for two controls: one active, one deleted.
2. Add `generatePackFromOpenKb()` as a pure function.
3. Add `isms-agent pack generate --openkb <dir> --pack <dir> --controls <ids>`.
4. Generate deterministic `pack.json`, `source-manifest.json`, and control JSON.
5. Run `validatePack()` in tests against generated output.

The first slice should not attempt to generate polished `common_defects` or rich `observable_signals` for every control. Those fields can start conservative and be improved after the human-review workflow is explicit.
