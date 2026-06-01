# Security Policy

ISMS-P Agent is local-first. The CLI is designed to analyze local project context and read-only connector metadata without collecting secrets, customer records, or private operational evidence into the public repository.

## Supported Versions

This repository is currently an early-preview source release. Security fixes are handled on the default branch until versioned releases are introduced.

## Reporting a Vulnerability

Please open a private security advisory in GitHub if available. If private advisories are unavailable, open a minimal issue that describes the affected area without including exploit details, secrets, tokens, customer data, or production evidence.

Include:

- affected command, connector, or documentation path,
- expected impact,
- safe reproduction steps using synthetic data,
- proposed mitigation if known.

Do not include:

- API tokens, OAuth tokens, cookies, SSH keys, access keys, passwords, or session material,
- customer records, employee records, or other PII,
- production scan outputs, screenshots, access exports, or review overlays,
- private evidence paths from your local workspace.

## Security Boundaries

- Scanner output is candidate evidence only.
- Evidence existence is not control satisfaction.
- Accepted evidence requires human control-owner review.
- Public exports must omit locators, raw payloads, private paths, source excerpts, and review rationale.
- GitHub, Vercel, and Cloudflare operations are read-only in the MVP.

## Public Release Checks

Before publishing a branch, run:

```bash
npm run check
npm test
node dist/cli.js evidence validate --public
```

Also scan tracked files for secrets, absolute local paths, private service names, real evidence, and unsupported certification claims.
