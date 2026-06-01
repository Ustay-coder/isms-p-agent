# Contributing

ISMS-P Agent is an early-preview, CLI-first project for ISMS-P readiness work. Contributions should improve source-traceable knowledge, conservative analysis, and private-by-default evidence workflows.

This project does not certify a service, create final audit evidence, or replace a human control owner.

## Good First Contributions

- Improve `packs/isms-p-core-v0` controls with clearer requirements, source references, and evidence expectations.
- Add tests for analyzer, scanner, generator, and evidence-review behavior.
- Improve docs that explain local-first operation and public-safety boundaries.
- Add read-only connector coverage when the collected metadata can be represented as candidate evidence only.

## Control Pack Rules

Read [docs/control-pack-contributions.md](docs/control-pack-contributions.md) before changing `packs/isms-p-core-v0`.

Control-pack changes must keep these fields reviewable:

- `source_refs` must point to the source material used for the requirement.
- Evidence mappings must describe what would support a control, not claim that a scanner output satisfies it.
- Judgment basis must remain explicit: `observed`, `document-backed`, `inferred`, or `needs_confirmation`.
- If the source is uncertain or incomplete, mark the gap instead of filling it with speculation.

Do not include private company policies, customer data, screenshots, logs, access exports, or service-specific credentials in a control pack.

## Evidence Rules

Evidence contributions must be examples or metadata only. Do not commit real operational evidence.

Allowed public examples:

- Synthetic fixture data.
- Redacted examples that contain no secrets, customer records, account IDs, private paths, or production service details.
- Templates that describe what a control owner should review.

Not allowed:

- API tokens, OAuth tokens, cookies, SSH keys, access keys, or passwords.
- Customer records, employee records, or other PII.
- Real cloud account inventories, screenshots, production scan outputs, or review overlays.
- Private evidence paths from a local workspace.

## Development

Use Node.js 22 or later.

```bash
npm ci
npm run check
npm test
node dist/cli.js pack validate packs/isms-p-core-v0
node dist/cli.js evidence validate --public
```

Run focused tests for the area you changed first, then run the full check before opening a pull request.

## Pull Request Checklist

- The change is source-traceable and keeps conservative wording.
- Public docs do not claim certification readiness.
- Real evidence, scans, reports, review overlays, secrets, and PII are not committed.
- Generated or private workspace files are ignored unless they are intentional synthetic fixtures.
- Tests or validation commands are included in the PR description.

## Korean Note

이 프로젝트는 ISMS-P 인증을 자동으로 보장하지 않습니다. 기여자는 통제항목, 요구사항, 증적 기대치를 개선할 수 있지만, 실제 운영 증적과 최종 판단은 각 조직의 담당자 검토를 거쳐야 합니다.
