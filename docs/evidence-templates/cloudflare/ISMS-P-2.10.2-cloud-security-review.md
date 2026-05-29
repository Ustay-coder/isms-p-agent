# Cloudflare Security Review Evidence Template

## Requirement

ISMS-P-2.10.2.cloudflare-config-export

## Purpose

Use this private template to record a dated security review of Cloudflare configuration. This template is for operating evidence only; scanner output can provide a candidate configuration snapshot, but it does not prove that a qualified human reviewed the current service scope and follow-up status.

## Accepted Criteria

Accepted operating evidence must include:

- review date, reviewer, review scope, and reviewed configuration areas,
- follow-up items or explicit confirmation that no follow-up is required,
- private snapshot storage location for the reviewed configuration materials,
- confirmation that the review covers the current service scope.

## Private Storage

Store the completed review record and supporting private artifacts under:

```text
evidence/private/ISMS-P-2.10.2/security-review/
```

Private artifacts may contain account identifiers, zone identifiers, service scope notes, configuration snapshots, reviewer notes, and follow-up details. Do not copy those values into public examples, reports, scanner output, or committed repository files.

## Public Export Rule

Public exports may state that a private Cloudflare security review exists, the review date, the reviewed configuration areas at a high level, the requirement it supports, and whether follow-up is complete. Public exports must not include account identifiers, zone identifiers, resource names, snapshot contents, reviewer notes, or private file paths.

## Review Command

After the private review is complete, record the decision with:

```bash
isms-agent evidence review <evidence-id> \
  --requirement ISMS-P-2.10.2.cloudflare-config-export \
  --decision accepted \
  --reviewer <reviewer-name> \
  --rationale "Private Cloudflare security review completed against current service scope."
```
