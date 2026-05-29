# Cloudflare Change Approval Evidence Template

## Requirement

ISMS-P-2.10.2.cloud-change-approval

## Purpose

Use this private template to record approval evidence for Cloudflare configuration changes. This template is for operating evidence only; scanner output can show current configuration metadata, but it does not prove that the change was requested, approved, rejected, or retrospectively reviewed.

## Accepted Criteria

Accepted operating evidence must include:

- change category, requester, approver, date, and reason,
- affected configuration area without private resource names,
- approval, rejection, or follow-up decision,
- retrospective review for emergency changes, including reviewer and review date.

## Private Storage

Store the completed approval record and supporting private artifacts under:

```text
evidence/private/ISMS-P-2.10.2/change-approval/
```

Private artifacts may contain account identifiers, zone identifiers, ticket references, internal resource names, approver notes, and rollback or follow-up details. Do not copy those values into public examples, reports, scanner output, or committed repository files.

## Public Export Rule

Public exports may state that private Cloudflare change approval evidence exists, the change category, the requirement it supports, and whether approval or follow-up was completed. Public exports must not include account identifiers, zone identifiers, private resource names, ticket contents, raw exports, screenshots, reviewer notes, private rationale, or private file paths.

## Review Command

After the private review is complete, record the decision with:

```bash
isms-agent evidence review <evidence-id> \
  --requirement ISMS-P-2.10.2.cloud-change-approval \
  --decision accepted \
  --private-evidence evidence/private/ISMS-P-2.10.2/change-approval/<record-file> \
  --reviewer <reviewer-name> \
  --rationale "Private Cloudflare change approval evidence reviewed by the control owner."
```
