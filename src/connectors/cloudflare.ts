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
  const zoneResult = await findZone(client, zoneInput);
  if (!zoneResult.result.ok) {
    return [apiUncertainty("cloudflare:zone", "zone", "zone metadata", "/zones", zoneResult.result.status)];
  }
  if (!zoneResult.zoneId) {
    return [
      cloudflareNeedsConfirmation("cloudflare:zone", "Cloudflare zone was not observed.", {
        product: "zone",
        endpoint: "/zones",
        permission_status: "not_observed",
        requirement_ids: [CLOUDFLARE_REQUIREMENTS.configExport],
        available: false,
        exists: false
      })
    ];
  }

  const products = normalizeCloudflareProducts(input.products);
  const signals: ScanSignal[] = [];

  if (products.includes("zone")) {
    signals.push(cloudflareObserved("cloudflare:zone", "Cloudflare zone metadata is available.", {
      product: "zone",
      endpoint: "/zones",
      permission_status: "available",
      requirement_ids: [CLOUDFLARE_REQUIREMENTS.configExport],
      available: true,
      exists: true,
      status: zoneResult.status ?? "unknown"
    }));

    const ssl = await client.get(`/zones/${encodeURIComponent(zoneResult.zoneId)}/settings/ssl`);
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

  if (products.includes("waf")) {
    const waf = await client.list(`/zones/${encodeURIComponent(zoneResult.zoneId)}/rulesets`);
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

  if (products.includes("access")) {
    const access = await client.list(`/zones/${encodeURIComponent(zoneResult.zoneId)}/access/apps`);
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

  if (products.includes("dns")) {
    const dns = await client.list(`/zones/${encodeURIComponent(zoneResult.zoneId)}/dns_records`);
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

  return signals;
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

function requirementIdsForProduct(product: string): string[] {
  if (product === "access") {
    return [CLOUDFLARE_REQUIREMENTS.adminAccessReview];
  }
  return [CLOUDFLARE_REQUIREMENTS.configExport];
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
