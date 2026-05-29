import { CloudflareApiClient, type CloudflareApiResult } from "./cloudflare-api.js";
import { normalizeCloudflareProducts, type CloudflareProduct } from "./cloudflare-products.js";
import { CLOUDFLARE_REQUIREMENTS, cloudflareNeedsConfirmation, cloudflareObserved, permissionMetadata } from "./cloudflare-safety.js";
import type { ScanSignal } from "../schemas/scan.js";

export interface CloudflareInput {
  zone: string;
  token?: string;
  accountId?: string;
  products?: CloudflareProduct[];
}

export async function scanCloudflare(input: CloudflareInput, fetchImpl: typeof fetch = fetch): Promise<ScanSignal[]> {
  if (!input.token) {
    return [
      cloudflareNeedsConfirmation("cloudflare:token", "CLOUDFLARE_API_TOKEN is required to scan Cloudflare metadata.", {
        product: "cloudflare",
        endpoint: "auth",
        permission_status: "missing_token",
        requirement_ids: [CLOUDFLARE_REQUIREMENTS.configExport],
        available: false
      })
    ];
  }

  const client = new CloudflareApiClient(input.token, fetchImpl);
  const zoneInput = input.zone.trim();
  const products = normalizeCloudflareProducts(input.products);
  const signals: ScanSignal[] = [];
  let zoneId: string | undefined;
  let zoneStatus: string | undefined;

  if (products.some(isZoneDependentProduct)) {
    const zoneResult = await findZone(client, zoneInput);
    if (!zoneResult.result.ok) {
      signals.push(...zoneUnavailableSignals(products, zoneResult.result.status));
    } else if (!zoneResult.zoneId) {
      signals.push(...zoneNotObservedSignals(products));
    } else {
      zoneId = zoneResult.zoneId;
      zoneStatus = zoneResult.status;
    }
  }

  if (zoneId && products.includes("zone")) {
    signals.push(cloudflareObserved("cloudflare:zone", "Cloudflare zone metadata is available.", {
      product: "zone",
      endpoint: "/zones",
      permission_status: "available",
      requirement_ids: [CLOUDFLARE_REQUIREMENTS.configExport],
      available: true,
      exists: true,
      status: zoneStatus ?? "unknown"
    }));
  }

  if (zoneId && products.includes("zone")) {
    const ssl = await client.get(`/zones/${encodeURIComponent(zoneId)}/settings/ssl`);
    if (ssl.ok) {
      const tlsMode = stringValue(asRecord(asRecord(ssl.body).result).value) ?? "unknown";
      signals.push(cloudflareObserved("cloudflare:tls-mode", `Cloudflare TLS/SSL mode is ${tlsMode}.`, {
        product: "zone",
        endpoint: "/zones/{zone_id}/settings/ssl",
        permission_status: "available",
        requirement_ids: [CLOUDFLARE_REQUIREMENTS.configExport],
        available: true,
        tlsMode
      }));
    } else {
      signals.push(apiUncertainty("cloudflare:tls-mode", "zone", "TLS/SSL setting", "/zones/{zone_id}/settings/ssl", ssl.status));
    }
  }

  if (zoneId && products.includes("waf")) {
    const waf = await client.list(`/zones/${encodeURIComponent(zoneId)}/rulesets`);
    if (waf.ok) {
      const available = waf.items.length > 0;
      signals.push(cloudflareObserved("cloudflare:waf", available ? "Cloudflare WAF/ruleset metadata is available." : "Cloudflare WAF/ruleset metadata was not observed.", {
        product: "waf",
        endpoint: "/zones/{zone_id}/rulesets",
        permission_status: "available",
        requirement_ids: [CLOUDFLARE_REQUIREMENTS.configExport],
        available,
        count: waf.items.length,
        rulesetCount: waf.items.length
      }));
    } else {
      signals.push(apiUncertainty("cloudflare:waf", "waf", "WAF/ruleset metadata", "/zones/{zone_id}/rulesets", waf.status));
    }
  }

  if (zoneId && products.includes("access")) {
    const access = await client.list(`/zones/${encodeURIComponent(zoneId)}/access/apps`);
    if (access.ok) {
      signals.push(cloudflareObserved("cloudflare:access-apps", `Cloudflare Access metadata shows ${access.items.length} application(s).`, {
        product: "access",
        endpoint: "/zones/{zone_id}/access/apps",
        permission_status: "available",
        requirement_ids: [CLOUDFLARE_REQUIREMENTS.adminAccessReview],
        available: access.items.length > 0,
        count: access.items.length,
        appCount: access.items.length
      }));
    } else {
      signals.push(apiUncertainty("cloudflare:access-apps", "access", "Access applications", "/zones/{zone_id}/access/apps", access.status));
    }
  }

  if (zoneId && products.includes("dns")) {
    const dns = await client.list(`/zones/${encodeURIComponent(zoneId)}/dns_records`);
    if (dns.ok) {
      const counts = new Map<string, number>();
      for (const record of dns.items) {
        const type = stringValue(asRecord(record).type) ?? "unknown";
        counts.set(type, (counts.get(type) ?? 0) + 1);
      }
      const recordTypes = [...counts.keys()].sort();
      signals.push(cloudflareObserved("cloudflare:dns-records", `Cloudflare DNS metadata shows ${dns.items.length} record(s).`, {
        product: "dns",
        endpoint: "/zones/{zone_id}/dns_records",
        permission_status: "available",
        requirement_ids: [CLOUDFLARE_REQUIREMENTS.configExport],
        available: dns.items.length > 0,
        count: dns.items.length,
        recordCount: dns.items.length,
        recordTypes,
        recordTypeCounts: recordTypes.map((type) => `${type}:${counts.get(type) ?? 0}`)
      }));
    } else {
      signals.push(apiUncertainty("cloudflare:dns-records", "dns", "DNS records", "/zones/{zone_id}/dns_records", dns.status));
    }
  }

  if (zoneId && products.includes("api-gateway")) {
    signals.push(await scanApiGateway(client, zoneId));
  }

  for (const product of products.filter(isAccountIndependentProduct)) {
    signals.push(...await scanAccountProduct(client, product, input.accountId, zoneId));
  }

  return signals;
}

async function scanAccountProduct(
  client: CloudflareApiClient,
  product: CloudflareProduct,
  accountId: string | undefined,
  zoneId: string | undefined
): Promise<ScanSignal[]> {
  if (!accountId) {
    return [cloudflareNeedsConfirmation(`cloudflare:${product}`, `Cloudflare ${product} scan requires --cloudflare-account.`, {
      product,
      endpoint: "account",
      permission_status: "missing_account_id",
      requirement_ids: requirementIdsForProduct(product),
      available: false
    })];
  }

  if (product === "workers") {
    return [await scanWorkers(client, accountId)];
  }
  if (product === "r2") {
    return [await scanR2(client, accountId)];
  }
  if (product === "hyperdrive") {
    return [await scanHyperdrive(client, accountId)];
  }
  if (product === "api-gateway") {
    if (!zoneId) {
      return [cloudflareNeedsConfirmation("cloudflare:api-gateway", "Cloudflare api-gateway metadata requires zone confirmation.", {
        product: "api-gateway",
        endpoint: "/zones/{zone_id}/api_gateway/discovery/operations",
        permission_status: "zone_unavailable",
        requirement_ids: requirementIdsForProduct("api-gateway"),
        available: false
      })];
    }
    return [await scanApiGateway(client, zoneId)];
  }
  return [];
}

async function scanWorkers(client: CloudflareApiClient, accountId: string): Promise<ScanSignal> {
  const result = await client.list(`/accounts/${encodeURIComponent(accountId)}/workers/scripts`);
  if (!result.ok) {
    return accountProductFailure("workers", "/accounts/{account_id}/workers/scripts", result.status);
  }
  return cloudflareObserved("cloudflare:workers", `Cloudflare Workers metadata shows ${result.items.length} script(s).`, {
    product: "workers",
    endpoint: "/accounts/{account_id}/workers/scripts",
    permission_status: "available",
    requirement_ids: requirementIdsForProduct("workers"),
    available: result.items.length > 0,
    count: result.items.length
  });
}

async function scanR2(client: CloudflareApiClient, accountId: string): Promise<ScanSignal> {
  const result = await client.get(`/accounts/${encodeURIComponent(accountId)}/r2/buckets`);
  if (!result.ok) {
    return accountProductFailure("r2", "/accounts/{account_id}/r2/buckets", result.status);
  }
  const bucketCount = countR2Buckets(result.body);
  return cloudflareObserved("cloudflare:r2", `Cloudflare R2 metadata shows ${bucketCount} bucket(s).`, {
    product: "r2",
    endpoint: "/accounts/{account_id}/r2/buckets",
    permission_status: "available",
    requirement_ids: requirementIdsForProduct("r2"),
    available: bucketCount > 0,
    count: bucketCount
  });
}

async function scanHyperdrive(client: CloudflareApiClient, accountId: string): Promise<ScanSignal> {
  const result = await client.list(`/accounts/${encodeURIComponent(accountId)}/hyperdrive/configs`);
  if (!result.ok) {
    return accountProductFailure("hyperdrive", "/accounts/{account_id}/hyperdrive/configs", result.status);
  }
  return cloudflareObserved("cloudflare:hyperdrive", `Cloudflare Hyperdrive metadata shows ${result.items.length} config(s).`, {
    product: "hyperdrive",
    endpoint: "/accounts/{account_id}/hyperdrive/configs",
    permission_status: "available",
    requirement_ids: requirementIdsForProduct("hyperdrive"),
    available: result.items.length > 0,
    count: result.items.length
  });
}

async function scanApiGateway(client: CloudflareApiClient, zoneId: string): Promise<ScanSignal> {
  const result = await client.list(`/zones/${encodeURIComponent(zoneId)}/api_gateway/discovery/operations`);
  if (!result.ok) {
    return accountProductFailure("api-gateway", "/zones/{zone_id}/api_gateway/discovery/operations", result.status);
  }
  return cloudflareObserved("cloudflare:api-gateway", `Cloudflare API Gateway metadata shows ${result.items.length} discovered operation(s).`, {
    product: "api-gateway",
    endpoint: "/zones/{zone_id}/api_gateway/discovery/operations",
    permission_status: "available",
    requirement_ids: requirementIdsForProduct("api-gateway"),
    available: result.items.length > 0,
    count: result.items.length
  });
}

async function findZone(client: CloudflareApiClient, zoneInput: string): Promise<{ result: CloudflareApiResult; zoneId?: string; status?: string }> {
  if (zoneInput.includes(".")) {
    const result = await client.get("/zones", { name: zoneInput });
    const zone = asRecord(arrayValue(asRecord(result.body).result)[0]);
    return {
      result,
      zoneId: stringValue(zone.id),
      status: stringValue(zone.status)
    };
  }

  const result = await client.get(`/zones/${encodeURIComponent(zoneInput)}`);
  const zone = asRecord(asRecord(result.body).result);
  return {
    result,
    zoneId: result.ok ? zoneInput : undefined,
    status: stringValue(zone.status)
  };
}

function apiUncertainty(id: string, product: string, label: string, endpoint: string, status: number): ScanSignal {
  const statusText = status === 0 ? "network error" : `${status}`;
  return cloudflareNeedsConfirmation(id, `Cloudflare API returned ${statusText} while checking ${label}.`, {
    ...permissionMetadata(product, endpoint, requirementIdsForProduct(product)),
    available: false
  });
}

function zoneUnavailableSignals(products: CloudflareProduct[], status: number): ScanSignal[] {
  return products.filter(isZoneDependentProduct).map((product) => {
    if (product === "zone") {
      return apiUncertainty("cloudflare:zone", "zone", "zone metadata", "/zones", status);
    }
    return cloudflareNeedsConfirmation(productSignalId(product), `Cloudflare ${product} metadata requires zone confirmation.`, {
      product,
      endpoint: endpointForProduct(product),
      permission_status: "zone_unavailable",
      requirement_ids: requirementIdsForProduct(product),
      available: false
    });
  });
}

function zoneNotObservedSignals(products: CloudflareProduct[]): ScanSignal[] {
  return products.filter(isZoneDependentProduct).map((product) => {
    if (product === "zone") {
      return cloudflareNeedsConfirmation("cloudflare:zone", "Cloudflare zone was not observed.", {
        product: "zone",
        endpoint: "/zones",
        permission_status: "not_observed",
        requirement_ids: [CLOUDFLARE_REQUIREMENTS.configExport],
        available: false,
        exists: false
      });
    }
    return cloudflareNeedsConfirmation(productSignalId(product), `Cloudflare ${product} metadata requires an observed zone.`, {
      product,
      endpoint: endpointForProduct(product),
      permission_status: "zone_unavailable",
      requirement_ids: requirementIdsForProduct(product),
      available: false
    });
  });
}

function accountProductFailure(product: CloudflareProduct, endpoint: string, status: number): ScanSignal {
  const statusText = status === 0 ? "network error" : `${status}`;
  return cloudflareNeedsConfirmation(`cloudflare:${product}`, `Cloudflare API returned ${statusText} while checking ${product} metadata.`, {
    ...permissionMetadata(product, endpoint, requirementIdsForProduct(product)),
    available: false
  });
}

function isZoneDependentProduct(product: CloudflareProduct): boolean {
  return product === "zone" || product === "waf" || product === "access" || product === "dns" || product === "api-gateway";
}

function isAccountIndependentProduct(product: CloudflareProduct): boolean {
  return product === "workers" || product === "r2" || product === "hyperdrive";
}

function productSignalId(product: CloudflareProduct): string {
  if (product === "access") {
    return "cloudflare:access-apps";
  }
  if (product === "dns") {
    return "cloudflare:dns-records";
  }
  return `cloudflare:${product}`;
}

function endpointForProduct(product: CloudflareProduct): string {
  if (product === "waf") {
    return "/zones/{zone_id}/rulesets";
  }
  if (product === "access") {
    return "/zones/{zone_id}/access/apps";
  }
  if (product === "dns") {
    return "/zones/{zone_id}/dns_records";
  }
  if (product === "api-gateway") {
    return "/zones/{zone_id}/api_gateway/discovery/operations";
  }
  return "/zones";
}

function requirementIdsForProduct(product: string): string[] {
  if (product === "access") {
    return [CLOUDFLARE_REQUIREMENTS.adminAccessReview];
  }
  if (product === "workers" || product === "r2" || product === "hyperdrive" || product === "api-gateway") {
    return [CLOUDFLARE_REQUIREMENTS.configExport, CLOUDFLARE_REQUIREMENTS.changeApproval];
  }
  return [CLOUDFLARE_REQUIREMENTS.configExport];
}

function countR2Buckets(body: unknown): number {
  const result = asRecord(asRecord(body).result);
  const buckets = arrayValue(result.buckets);
  if (buckets.length > 0) {
    return buckets.length;
  }
  return arrayValue(asRecord(body).result).length;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
