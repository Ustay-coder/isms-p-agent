# Cloudflare Admin Access Review Evidence Template

## Requirement

ISMS-P-2.10.2.cloud-admin-access-review

## Purpose

Use this private template to record a human review of Cloudflare administrative access. This template is for operating evidence only; Cloudflare scanner output can identify candidate configuration signals, but it does not prove that privileged access was reviewed or approved.

## Accepted Criteria

Accepted operating evidence must include:

- review date, reviewer, review scope, and reviewed role categories,
- confirmation that each privileged user or role category still has a current business need,
- follow-up actions for removed, changed, excessive, or unconfirmed access,
- human owner and completion date for each accepted review decision.

## Private Storage

Store the completed review record and supporting private artifacts under:

```text
evidence/private/ISMS-P-2.10.2/access-review/
```

Private artifacts may describe account identifiers, zone identifiers, role names, user identities, reviewer notes, and follow-up details. Do not copy those values into public examples, reports, scanner output, or committed repository files.

## Public Export Rule

Public exports may state that a private Cloudflare administrative access review exists, when it was reviewed, the requirement it supports, and whether follow-up is complete. Public exports must not include account identifiers, zone identifiers, user identities, resource names, access lists, raw exports, screenshots, reviewer notes, private rationale, or private file paths.

## Review Command

After the private review is complete, record the decision with:

```bash
ismsp evidence review <evidence-id> \
  --requirement ISMS-P-2.10.2.cloud-admin-access-review \
  --decision accepted \
  --private-evidence evidence/private/ISMS-P-2.10.2/access-review/<record-file> \
  --reviewer <reviewer-name> \
  --rationale "Private Cloudflare admin access review completed by the control owner."
```
