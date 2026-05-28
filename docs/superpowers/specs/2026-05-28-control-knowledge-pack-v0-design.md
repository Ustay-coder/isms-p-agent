# Control Knowledge Pack v0 Design

Date: 2026-05-28

## 1. Decision

The OpenKB ISMS-P workspace is the source of truth for Control Knowledge Pack v0.

Canonical source root:

```text
/Users/jeean/Documents/obsidian-vault/evaluate.club/09_보안_ISMS-P_openkb
```

The CLI repository may package derived control knowledge, examples, and tests, but it must not silently redefine control IDs, titles, applicability, or source status when OpenKB already has a value.

## 2. Purpose

Control Knowledge Pack v0 turns three high-value OpenKB controls into structured JSON that the CLI analyzer can use.

The pack should reduce `needs_confirmation` caused by empty control fields. It should not make the analyzer more aggressive. The pack gives the analyzer better terms, evidence expectations, and source references so it can explain gaps with less ambiguity.

## 3. Scope

Pack v0 contains exactly three controls:

| Canonical ID | Title | OpenKB status | v0 role |
|---|---|---|---|
| `ISMS-P-2.5.3` | 사용자 인증 | 유지 | Active technical and operating control |
| `ISMS-P-2.5.6` | 접근권한 검토 | 삭제 | Deleted-control residual-risk check |
| `ISMS-P-2.10.2` | 클라우드 보안 | 유지 | Active cloud security control |

These IDs are fixed from OpenKB for v0, even if other ISMS-P source profiles or legacy exports use different numbering.

## 4. Non-Goals

Pack v0 will not:

- cover all ISMS-P controls,
- resolve every numbering conflict across all source profiles,
- claim that OpenKB OCR-derived content is official final law text,
- ship evaluate.club private paths or customer/service-specific facts in the public pack,
- produce final audit evidence,
- treat a deleted control as a normal missing-control gap.

## 5. Source Hierarchy

The source hierarchy is:

1. OpenKB compiled and wiki material under `09_보안_ISMS-P_openkb`.
2. OpenKB raw legal and official normalized material.
3. OpenKB overlay evidence/gap material as private or example-only input.
4. Public KISA notice and official source metadata for freshness checks.
5. CLI repository examples and tests.

The public pack may include source references to OpenKB-relative paths. It must not include absolute private workspace paths in distributed JSON.

## 6. Pack Layout

```text
packs/
  isms-p-core-v0/
    pack.json
    sources/
      source-manifest.json
    controls/
      ISMS-P-2.5.3.json
      ISMS-P-2.5.6.json
      ISMS-P-2.10.2.json
    examples/
      startup-saas/
        raw/
          isms-p-core-v0.md
        project/
          authentication-review.md
          cloud-security-review.md
        expected/
          controls/
          reports/
```

`pack.json` describes the pack name, version, canonical source root kind, control count, and review status.

`source-manifest.json` lists OpenKB-relative files used to derive the pack. It also records official notice metadata used for drift awareness.

Control JSON files are the runtime inputs copied into `controls/` by the future pack loader.

## 7. Control Schema Extension

Pack controls continue to satisfy the existing `ControlKnowledge` shape. They add optional metadata fields that consumers may ignore:

```json
{
  "schemaVersion": 1,
  "control_id": "ISMS-P-2.5.3",
  "title": "사용자 인증",
  "domain": "보호대책 요구사항",
  "category": "인증 및 권한관리",
  "requirement": "",
  "intent": "",
  "applicability_questions": [],
  "observable_signals": [],
  "required_operating_practices": [],
  "required_evidence": [],
  "common_defects": [],
  "automation_potential": "partial",
  "human_review_required": true,
  "source_refs": [],
  "pack": {
    "name": "isms-p-core-v0",
    "source_of_truth": "openkb",
    "openkb_control_id": "ISMS-P-2.5.3",
    "effective_status": "active",
    "review_status": "needs_human_review",
    "source_confidence": "ocr_derived"
  }
}
```

The analyzer should continue reading only the base fields until a later schema-aware analyzer exists.

## 8. Control Design

### ISMS-P-2.5.3 사용자 인증

Intent: confirm that important systems and personal or sensitive information are protected by safe authentication procedures and stronger authentication where required.

Observable signals should include terms that local, GitHub, Vercel, and Cloudflare scans can plausibly observe:

- `mfa`
- `two-factor`
- `session timeout`
- `login failure limit`
- `admin authentication`
- `oauth`
- `auth route`
- `authentication test`

Required operating practices:

- authentication policy ownership and review cycle,
- authentication setting change approval,
- privileged or administrator MFA review,
- login failure and abnormal authentication review,
- exception approval for users or systems outside the standard authentication pattern.

Required evidence:

- user authentication policy or procedure,
- MFA and session configuration record,
- authentication setting change approval record,
- periodic authentication control review record,
- abnormal login or failed-login review record.

Common defects:

- MFA exists for code paths but no owner or review cycle is documented,
- session policy exists but is not tied to a formal control owner,
- administrator authentication differs from normal user authentication but is not reviewed,
- authentication exceptions are handled informally.

### ISMS-P-2.5.6 접근권한 검토

OpenKB marks this control as deleted. Pack v0 must model it as `deleted_residual_risk`, not as an active control gap.

Intent: preserve traceability that the old control was deleted while still asking whether access-review duties remain through other controls, contracts, privacy obligations, or customer security requirements.

Observable signals:

- `access review`
- `permission review`
- `role review`
- `admin role`
- `organization member`
- `deleted control`
- `residual risk`

Required operating practices:

- deleted-control decision review,
- residual access-review risk assessment,
- mapping to surviving controls or contractual requirements,
- human confirmation before treating the item as not applicable.

Required evidence:

- deleted-control applicability note,
- residual risk review record,
- legal or contractual access-review requirement check,
- mapping record to active access control requirements.

Common defects:

- treating the deleted control as if no access review is needed anywhere,
- creating a normal remediation gap from a deleted control,
- losing the historical mapping and confusing users who search for access review.

Analyzer behavior for this control should remain conservative. Until explicit applicability metadata is supported, it may still return `needs_confirmation`, but report language must explain the deleted-control status.

### ISMS-P-2.10.2 클라우드 보안

Intent: confirm that cloud use has defined responsibility, secure configuration, restricted administrator access, monitoring, and periodic review.

Observable signals:

- `cloudflare`
- `worker`
- `r2`
- `queue`
- `secret binding`
- `tls`
- `waf`
- `dns`
- `vercel project`
- `deployment protection`
- `cloud administrator`
- `cloud setting review`

Required operating practices:

- cloud responsibility and role definition,
- cloud security baseline and change approval,
- administrator privilege minimization and MFA,
- cloud setting monitoring,
- periodic cloud security review and follow-up tracking.

Required evidence:

- cloud responsibility matrix or policy,
- cloud security baseline,
- Cloudflare or Vercel configuration export,
- cloud administrator access review record,
- cloud setting change approval record,
- periodic cloud security review record.

Common defects:

- cloud resources exist but responsibility boundaries are not documented,
- settings are captured once but not reviewed periodically,
- administrator roles are not separated from deployment roles,
- secret names or bindings exist but rotation and approval evidence is missing.

## 9. Source Manifest Requirements

Each control must cite OpenKB-relative source paths, not absolute local paths.

Minimum source references:

- `raw/legal/7의2_ISMS-P_인증기준_항목_목록.jsonl`
- `compiled/controls/annex_7_2_mapping.jsonl`
- `compiled/citations/source_claims.jsonl`
- `compiled/evidence/evidence_requirements.jsonl`
- `wiki/controls/.../<control>.md`

Private overlay paths may be cited only in examples or development notes:

- `overlays/evaluate-club/evidence/...`
- `overlays/evaluate-club/gaps/...`
- `overlays/evaluate-club/assets/...`

## 10. Quality Gates

Pack v0 is acceptable only if:

- all three controls have non-empty `observable_signals`,
- all active controls have non-empty `required_operating_practices`,
- all active controls have non-empty `required_evidence`,
- deleted controls include `pack.effective_status = "deleted_residual_risk"`,
- public pack files do not contain `/Users/`, `evaluate.club` private code paths, API keys, tokens, or customer data,
- source references are OpenKB-relative,
- `npm test`, `npm run check`, and `git diff --check` pass after implementation.

## 11. CLI Integration Direction

The first implementation should be small:

1. Add the pack files under `packs/isms-p-core-v0/`.
2. Add a read-only pack loader command or import path later.
3. For immediate MVP value, add tests that copy the three control JSON files into a temporary workspace `controls/` directory.
4. Run `scan --local`, `report`, and `ask-context` to prove the analyzer can produce more specific missing items than `scanner coverage` alone.

The pack loader does not need to exist before the pack itself is valuable.

## 12. Acceptance Criteria

- The design fixes OpenKB as Source of Truth.
- The three v0 controls and their special handling are unambiguous.
- The deleted `ISMS-P-2.5.6` control cannot be accidentally treated as a normal gap in the design.
- The pack layout is implementable without new dependencies.
- Public pack output avoids private service details while preserving source traceability.
