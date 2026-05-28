import type { ScanSignal } from "../schemas/scan.js";

export interface CloudflareInput {
  zone: string;
  token?: string;
}

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";

export async function scanCloudflare(input: CloudflareInput, fetchImpl: typeof fetch = fetch): Promise<ScanSignal[]> {
  if (!input.token) {
    return [needsConfirmation("cloudflare:token", "CLOUDFLARE_API_TOKEN is required to scan Cloudflare metadata.", { zone: input.zone })];
  }

  const zoneInput = input.zone.trim();
  const zoneResult = await findZone(fetchImpl, zoneInput, input.token);
  if (!zoneResult.result.ok) {
    return [apiUncertainty("cloudflare:zone", "zone metadata", zoneResult.result.status, zoneInput)];
  }
  if (!zoneResult.zoneId) {
    return [needsConfirmation("cloudflare:zone", "Cloudflare zone was not observed.", { zone: zoneInput, exists: false })];
  }

  const signals: ScanSignal[] = [{
    id: "cloudflare:zone",
    source: "cloudflare",
    basis: "observed",
    summary: "Cloudflare zone metadata is available.",
    paths: [],
    metadata: { zone: zoneInput, exists: true, status: zoneResult.status ?? "unknown" }
  }];

  const ssl = await getJson(fetchImpl, `${CLOUDFLARE_API_BASE}/zones/${encodeURIComponent(zoneResult.zoneId)}/settings/ssl`, input.token);
  if (ssl.ok) {
    const tlsMode = stringValue(asRecord(asRecord(ssl.body).result).value) ?? "unknown";
    signals.push({
      id: "cloudflare:tls-mode",
      source: "cloudflare",
      basis: "observed",
      summary: `Cloudflare TLS/SSL mode is ${tlsMode}.`,
      paths: [],
      metadata: { tlsMode }
    });
  } else {
    signals.push(apiUncertainty("cloudflare:tls-mode", "TLS/SSL setting", ssl.status, zoneInput));
  }

  const waf = await getJson(fetchImpl, `${CLOUDFLARE_API_BASE}/zones/${encodeURIComponent(zoneResult.zoneId)}/rulesets`, input.token);
  if (waf.ok) {
    const result = arrayValue(asRecord(waf.body).result);
    const available = result.length > 0;
    signals.push({
      id: "cloudflare:waf",
      source: "cloudflare",
      basis: "observed",
      summary: available ? "Cloudflare WAF/ruleset metadata is available." : "Cloudflare WAF/ruleset metadata was not observed.",
      paths: [],
      metadata: { available, rulesetCount: result.length }
    });
  } else {
    signals.push(apiUncertainty("cloudflare:waf", "WAF/ruleset metadata", waf.status, zoneInput));
  }

  const access = await getJson(fetchImpl, `${CLOUDFLARE_API_BASE}/zones/${encodeURIComponent(zoneResult.zoneId)}/access/apps`, input.token);
  if (access.ok) {
    const count = arrayValue(asRecord(access.body).result).length;
    signals.push({
      id: "cloudflare:access-apps",
      source: "cloudflare",
      basis: "observed",
      summary: `Cloudflare Access metadata shows ${count} application(s).`,
      paths: [],
      metadata: { appCount: count }
    });
  } else {
    signals.push(apiUncertainty("cloudflare:access-apps", "Access applications", access.status, zoneInput));
  }

  const dns = await getJson(fetchImpl, `${CLOUDFLARE_API_BASE}/zones/${encodeURIComponent(zoneResult.zoneId)}/dns_records`, input.token);
  if (dns.ok) {
    const records = arrayValue(asRecord(dns.body).result);
    const counts = new Map<string, number>();
    for (const record of records) {
      const type = stringValue(asRecord(record).type) ?? "unknown";
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    const recordTypes = [...counts.keys()].sort();
    signals.push({
      id: "cloudflare:dns-records",
      source: "cloudflare",
      basis: "observed",
      summary: `Cloudflare DNS metadata shows ${records.length} record(s).`,
      paths: [],
      metadata: {
        recordCount: records.length,
        recordTypes,
        recordTypeCounts: recordTypes.map((type) => `${type}:${counts.get(type) ?? 0}`)
      }
    });
  } else {
    signals.push(apiUncertainty("cloudflare:dns-records", "DNS records", dns.status, zoneInput));
  }

  return signals;
}

async function findZone(fetchImpl: typeof fetch, zoneInput: string, token: string): Promise<{ result: ApiResult; zoneId?: string; status?: string }> {
  if (zoneInput.includes(".")) {
    const result = await getJson(fetchImpl, `${CLOUDFLARE_API_BASE}/zones?name=${encodeURIComponent(zoneInput)}`, token);
    const zone = asRecord(arrayValue(asRecord(result.body).result)[0]);
    return {
      result,
      zoneId: stringValue(zone.id),
      status: stringValue(zone.status)
    };
  }

  const result = await getJson(fetchImpl, `${CLOUDFLARE_API_BASE}/zones/${encodeURIComponent(zoneInput)}`, token);
  const zone = asRecord(asRecord(result.body).result);
  return {
    result,
    zoneId: result.ok ? zoneInput : undefined,
    status: stringValue(zone.status)
  };
}

interface ApiResult {
  ok: boolean;
  status: number;
  body: unknown;
}

async function getJson(fetchImpl: typeof fetch, url: string, token: string): Promise<ApiResult> {
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`
      }
    });
    return { ok: response.ok, status: response.status, body: await readJson(response) };
  } catch {
    return { ok: false, status: 0, body: undefined };
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function apiUncertainty(id: string, label: string, status: number, zone: string): ScanSignal {
  const statusText = status === 0 ? "network error" : `${status}`;
  return needsConfirmation(id, `Cloudflare API returned ${statusText} while checking ${label}.`, { zone });
}

function needsConfirmation(id: string, summary: string, metadata: Record<string, string | number | boolean | string[]>): ScanSignal {
  return { id, source: "cloudflare", basis: "needs_confirmation", summary, paths: [], metadata };
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
