# Small-Batch Control Expansion Design

Date: 2026-05-29

## 1. Decision

The first control expansion strategy is small-batch OpenKB expansion.

The project will not generate all ISMS-P controls at once. Each expansion batch must:

1. start from OpenKB as the Source of Truth,
2. generate or draft controls through the pack pipeline,
3. receive human curation at the requirement and evidence-mapping level,
4. pass public-pack and private-evidence safety gates,
5. prove the result against the evaluation service before merge.

The first expansion batch is:

```text
ISMS-P-2.1.1 정책의 유지관리
ISMS-P-2.3.1 외부자 현황 관리
ISMS-P-2.4.2 보안 교육
ISMS-P-2.9.4 로그 및 접속기록 관리
ISMS-P-2.10.1 보안시스템 운영
```

This batch is selected because it expands from the current technical controls into the operating system needed for ISMS-P readiness: policy lifecycle, external party inventory, training, logs, and security system operation.

## 2. Problem

The current core pack proves the model with three controls:

- `ISMS-P-2.5.3 사용자 인증`
- `ISMS-P-2.5.6 접근권한 검토`
- `ISMS-P-2.10.2 클라우드 보안`

The next risk is not lack of generated JSON. The real risk is scaling the pack in a way that makes reports look more certain than the underlying evidence supports.

Three failure modes must be avoided:

1. The agent expands many controls with shallow, unverifiable requirement mappings.
2. Scanner evidence is treated as operating evidence because it is easy to collect.
3. Public open-source pack content accidentally includes private service details, review rationale, customer data, or credentials.

Small-batch expansion keeps the system reviewable while the pack schema, generator, validators, and evidence-review overlay mature.

## 3. Source of Truth

OpenKB remains the Source of Truth for control identity, title, status, source lineage, and compiled evidence requirements.

Allowed direct source references in public pack controls:

```text
compiled/controls/*.jsonl
compiled/citations/*.jsonl
compiled/evidence/*.jsonl
wiki/controls/**/*.md
```

Rejected direct source references in public pack controls:

```text
raw/legal/*
overlays/*
/Users/*
apps/evaluation/*
service-specific private paths
credential-like values
customer data
```

`raw/legal/*` may be used for cross-checking and drift detection, but it must not become a direct `source_refs` entry in released control JSON.

## 4. Batch Selection Rules

Each batch should be small enough for a reviewer to inspect every control and every evidence requirement.

Default batch size:

```text
3 to 5 controls
```

A control is a good candidate for an early batch when it satisfies at least two of these conditions:

- it connects to evidence already produced or planned by connectors,
- it is foundational for many later controls,
- it introduces an operating practice that prevents scanner-only evidence inflation,
- it has clear OpenKB compiled evidence requirements,
- it is relevant to the evaluation service dogfood environment.

A control should be deferred when:

- source lineage does not include compiled or wiki OpenKB references,
- OpenKB status is deleted, merged, or conflicting and the residual-risk model is not yet defined,
- the requirement depends on legal or organizational interpretation beyond the current pack model,
- the only available evidence would be hand-written assertions.

## 5. First Batch Rationale

### ISMS-P-2.1.1 정책의 유지관리

This control anchors the policy lifecycle. Without it, generated evidence can show isolated configurations but cannot show that the organization maintains policy, ownership, and review cadence.

Expected evidence direction:

- security policy inventory,
- policy owner and review cadence,
- policy revision history,
- approval and distribution record.

### ISMS-P-2.3.1 외부자 현황 관리

This control creates the operating bridge for vendors, contractors, SaaS providers, and cloud/service integrations.

Expected evidence direction:

- external party inventory,
- owner and purpose for each external party,
- access or data-processing relationship,
- periodic review record.

### ISMS-P-2.4.2 보안 교육

This control introduces recurring people/process evidence. It prevents the pack from becoming only a technical scanner.

Expected evidence direction:

- annual security training plan,
- completion record,
- role-specific training evidence,
- follow-up for missing participants.

### ISMS-P-2.9.4 로그 및 접속기록 관리

This control connects directly to observability, log retention, Cloudflare logs, application logs, admin access logs, and incident readiness.

Expected evidence direction:

- log scope and retention policy,
- log collection configuration,
- access to logs and tamper-protection control,
- periodic log review record.

### ISMS-P-2.10.1 보안시스템 운영

This control pairs with `ISMS-P-2.10.2 클라우드 보안`. It captures the operating model for security systems rather than only cloud configuration snapshots.

Expected evidence direction:

- security system inventory,
- operating responsibility,
- configuration baseline,
- alert/review workflow,
- change and exception record.

## 6. Expansion Workflow

The expansion workflow has five phases.

### Phase 1: Stabilize the Runtime Flow

Before expanding controls, the CLI should support a repeatable workspace flow:

```bash
isms-agent pack install packs/isms-p-core-v0 --overwrite
isms-agent evidence review-cloudflare --dry-run
isms-agent evidence validate --public
isms-agent report --public
```

The purpose is to ensure reports can run from curated packs without manual file copying and that review overlays remain conservative.

### Phase 2: Generate Draft Controls

Run the OpenKB generator into a draft pack:

```bash
node dist/cli.js pack generate \
  --openkb /Users/jeean/Documents/obsidian-vault/evaluate.club/09_보안_ISMS-P_openkb \
  --pack packs/isms-p-core-v1 \
  --controls ISMS-P-2.1.1,ISMS-P-2.3.1,ISMS-P-2.4.2,ISMS-P-2.9.4,ISMS-P-2.10.1 \
  --version 0.2.0
```

Generated controls must start as:

```json
{
  "pack": {
    "source_of_truth": "openkb",
    "review_status": "needs_human_review"
  }
}
```

### Phase 3: Curate Requirement-Level Evidence

The draft controls are not release-ready until a human reviewer curates requirement-level mappings.

Each active control must have at least two evidence requirements. Each requirement must include:

- stable `requirement_id`,
- `control_id`,
- concise title,
- evidence kind or evidence types,
- review frequency,
- freshness expectation,
- direct OpenKB source references,
- public/private handling expectation.

Requirement IDs must describe audit intent, not implementation guesses.

Good:

```text
ISMS-P-2.9.4.log-retention-policy
ISMS-P-2.9.4.log-review-record
```

Poor:

```text
ISMS-P-2.9.4.cloudflare-logpush-enabled
ISMS-P-2.9.4.posthog-dashboard-screenshot
```

Connector-specific evidence can support a requirement, but it should not define the requirement.

### Phase 4: Promote Curated Controls

After curation, controls can be promoted from the draft pack into `packs/isms-p-core-v0`.

Promotion requires:

- `pack.json` control list update,
- `sources/source-manifest.json` update,
- one JSON control file per control,
- pack tests updated with the expected control list,
- validator gates passing.

The pack version should increase when released. The current public pack path can remain `isms-p-core-v0` while the manifest version advances; a future registry can introduce semver-named pack channels.

### Phase 5: Dogfood Against Evaluation Service

The evaluation service dogfood must answer these questions:

1. Do new controls appear in reports after `pack install`?
2. Are missing operating records shown as missing or follow-up, not satisfied?
3. Are scanner outputs still treated as candidate evidence?
4. Does `evidence validate --public` remain clean?
5. Does `report --public` avoid private review rationale and private evidence paths?

## 7. Quality Gates

Every small-batch expansion PR must pass:

```bash
npm test
npm run check
git diff --check
node dist/cli.js pack validate packs/isms-p-core-v0
node dist/cli.js pack install packs/isms-p-core-v0 --overwrite
node dist/cli.js evidence validate --public
node dist/cli.js report --public
```

Pack quality requirements:

- `pack.source_of_truth` is `openkb`.
- `source_refs` are present and public-safe.
- active controls have requirement-level evidence mappings.
- deleted controls preserve residual-risk handling.
- generated controls are not treated as curated until human-reviewed.
- public reports do not claim satisfaction from candidate evidence alone.

## 8. Evidence Safety Model

Public repository contents may include:

- control packs,
- schemas,
- validators,
- redacted examples,
- connector code,
- documentation,
- public-safe generated reports.

Public repository contents must not include:

- real evidence attachments,
- private evidence review rationale,
- Cloudflare account or zone identifiers,
- DNS record values,
- resource names that identify private infrastructure,
- customer data,
- API tokens or secrets.

The correct lifecycle is:

```text
scan output -> candidate evidence -> human review overlay -> accepted only with private operating evidence
```

Bulk connector review can mark evidence as `needs_followup` or `rejected`. It must not bulk-accept scanner evidence.

## 9. Implementation Slices

The design should be implemented in separate PRs:

1. `pack install` and report dogfood unblocker.
2. Cloudflare review rerun idempotency.
3. accepted operating evidence templates.
4. first small-batch control expansion.

This keeps the high-risk parts separate:

- runtime installation,
- review overlay behavior,
- private evidence acceptance guidance,
- pack content expansion.

## 10. Testing Strategy

Use a mix of unit, fixture, pack, and dogfood tests.

Unit tests:

- pack install copies controls and does not overwrite by default,
- review-cloudflare does not append duplicate unchanged reviews,
- review-cloudflare cannot bulk-accept scanner evidence.

Fixture tests:

- OpenKB generator emits selected controls deterministically,
- raw legal profile rows do not become direct `source_refs`,
- generated controls start with `needs_human_review`.

Pack tests:

- expected controls match `pack.json`,
- every active control has requirement-level evidence mappings,
- every requirement has source references,
- public-pack forbidden patterns are rejected.

Dogfood tests:

- install pack into workspace,
- run public evidence validation,
- generate public report,
- confirm new controls are missing or follow-up when operating evidence is absent.

## 11. Non-Goals

This design does not include:

- generating every ISMS-P control at once,
- remote OpenKB downloads,
- LLM API calls for control authoring,
- accepting scanner evidence as audit-ready evidence,
- storing private evidence in the public repository,
- building a pack registry,
- replacing human review for legal or certification interpretation.

## 12. Success Criteria

The first small-batch expansion succeeds when:

1. the five selected controls are promoted into the curated core pack,
2. every new active control has reviewable requirement-level evidence mappings,
3. pack validation passes,
4. public evidence validation passes,
5. public report generation works after `pack install`,
6. the evaluation service report remains conservative where operating evidence is missing,
7. no private evidence or review metadata enters the public repository.
