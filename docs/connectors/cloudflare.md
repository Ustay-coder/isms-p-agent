# Cloudflare Connector Permissions And Security

This connector is a read-only scanner for ISMS-P readiness analysis. It does not change Cloudflare resources and it does not accept scanner output as final audit evidence.

The API surface below was rechecked against Cloudflare official API documentation on 2026-05-29. Context7 could not be used during this check because the local account quota was exhausted; refresh with `npx ctx7@latest login` or `CONTEXT7_API_KEY` before relying on this table for a release gate.

## Token Handling

Pass the token through `CLOUDFLARE_API_TOKEN` only:

```bash
CLOUDFLARE_API_TOKEN=... isms-agent scan \
  --cloudflare evaluate.club \
  --cloudflare-account <account_id> \
  --cloudflare-products zone,access,waf,dns,workers,r2,hyperdrive,api-gateway
```

The token is used only as an `Authorization: Bearer ...` header. It must not appear in API URLs, scan JSON, evidence JSONL, reports, logs, review overlays, or public exports.

Use a short-lived, read-only token scoped to the target account and zone. Do not reuse deploy tokens, Wrangler write tokens, Global API keys, or product-admin tokens.

## API Surface

| Product | Method and endpoint | Minimum read permission to try first | Stored scanner metadata | Explicitly omitted |
| --- | --- | --- | --- | --- |
| Zone lookup | `GET /zones?name=<zone>` or `GET /zones/{zone_id}` | `Zone Read` | existence and zone status | account ID, account name, nameservers, plan, owner, registrar |
| TLS setting | `GET /zones/{zone_id}/settings/ssl` | `Zone Settings Read` | TLS mode string | certificates, private keys, hostnames |
| WAF/rulesets | `GET /zones/{zone_id}/rulesets` | `Account Rulesets Read` or `Account WAF Read`, depending on tenant permissions | ruleset count | rule expressions, rule IDs, actions, hostnames, IPs |
| Access applications | `GET /zones/{zone_id}/access/apps` | `Access: Apps and Policies Read` | app count | app names, domains, policies, identity provider data, users |
| DNS records | `GET /zones/{zone_id}/dns_records` | `DNS Read` | total count, record types, type counts | record names, content values, comments, proxied hostnames |
| Workers | `GET /accounts/{account_id}/workers/scripts` | `Workers Scripts Read` | script count | script names, code, routes, bindings, secrets, deployment metadata |
| R2 | `GET /accounts/{account_id}/r2/buckets` | `Workers R2 Storage Read` | bucket count | bucket names, object keys, object metadata, public domain names |
| Hyperdrive | `GET /accounts/{account_id}/hyperdrive/configs` | `Hyperdrive Read` | config count | config names, DB host, DB name, DB user, password, VPC service ID, caching values |
| API Gateway discovery | `GET /zones/{zone_id}/api_gateway/discovery/operations` | `Domain API Gateway Read` or `Account API Gateway Read` | discovered operation count | methods, hosts, endpoint paths, labels, traffic stats |

The connector intentionally does not call endpoints that download Worker code, list Worker secrets, list R2 objects, read Hyperdrive detail for a specific config, fetch Access policies, or export full API Gateway schemas.

## Least-Privilege Token Shape

Start with these permissions and remove product permissions that are outside the target service scope:

```text
Zone:
- Zone Read
- Zone Settings Read
- DNS Read
- Access: Apps and Policies Read
- Domain API Gateway Read

Account:
- Workers Scripts Read
- Workers R2 Storage Read
- Hyperdrive Read
- Account API Gateway Read, only when the zone-scoped API Gateway permission is not enough
- Account Rulesets Read or Account WAF Read, only if the WAF endpoint returns 403 with narrower zone permissions
```

If a product endpoint returns `401` or `403`, the connector records `needs_confirmation` with a `permission_status` instead of treating the control as satisfied. This is expected behavior for a partially scoped token.

## Public-Safe Output Contract

Cloudflare scan signals may contain only:

- product name,
- templated endpoint category,
- permission status,
- availability boolean,
- count,
- requirement IDs,
- snapshot ID,
- sensitivity label.

They must not contain resource identifiers that disclose infrastructure shape. In particular, do not store account IDs, zone IDs, Worker names, R2 bucket names, Hyperdrive names, database hosts, API paths, DNS values, Access application names, user identities, logs, request payloads, or token fragments.

Public exports must be generated through:

```bash
isms-agent report --public
isms-agent evidence export-public
isms-agent evidence validate --public
```

`evidence validate --public` is the release gate. A successful scan is only candidate evidence; a human review decision is still required before using it for certification readiness.

## Evaluation Service Dry-Run

For `apps/evaluation`, run the scanner from an ISMS-P workspace that contains the service under `project/evaluation`:

```bash
isms-agent scan \
  --local \
  --target project/evaluation \
  --include app,services,db,lib,specs,wrangler.toml \
  --exclude __tests__ \
  --cloudflare evaluate.club \
  --cloudflare-account <account_id> \
  --cloudflare-products zone,access,waf,dns,workers,r2,hyperdrive,api-gateway
```

Expected safe failure modes:

- missing `CLOUDFLARE_API_TOKEN`: one `cloudflare:token` signal with `basis: "needs_confirmation"`,
- missing `--cloudflare-account`: account product signals with `permission_status: "missing_account_id"`,
- insufficient token scope: product signal with `permission_status: "needs_permission_or_confirmation"`,
- zone lookup failure: zone-dependent products become `zone_unavailable`; account-independent products should still scan.

After the scan:

```bash
isms-agent evidence index
isms-agent report --public
isms-agent evidence validate --public
```

Review the generated warnings. Warnings about missing human review decisions are acceptable in dry-run mode, but they must be resolved before treating the evidence as certification-ready.

## Dogfood Note: 2026-05-29

The evaluation-service dry run confirmed that Cloudflare scanner evidence remains candidate evidence. Bulk review records `needs_followup` by default, reruns skip unchanged latest decisions, and public validation/report generation do not expose private review rationale.

## Official References

- Cloudflare API token permissions: https://developers.cloudflare.com/fundamentals/api/reference/permissions/
- List zones: https://developers.cloudflare.com/api/resources/zones/methods/list/
- Get zone setting: https://developers.cloudflare.com/api/resources/zones/subresources/settings/methods/get/
- List DNS records: https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/list/
- List account or zone rulesets: https://developers.cloudflare.com/api/resources/rulesets/methods/list/
- List Access applications: https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/applications/methods/list/
- List Workers: https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/list/
- List R2 buckets: https://developers.cloudflare.com/api/resources/r2/subresources/buckets/methods/list/
- List Hyperdrives: https://developers.cloudflare.com/api/resources/hyperdrive/subresources/configs/methods/list/
- API Gateway discovery: https://developers.cloudflare.com/api/resources/api_gateway/subresources/discovery/
