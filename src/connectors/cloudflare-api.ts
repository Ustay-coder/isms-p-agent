const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";
const MAX_PAGES = 25;

export type CloudflareApiFailureReason = "permission" | "network" | "api_error";

export type CloudflareApiResult =
  | { ok: true; status: number; body: unknown; endpoint: string }
  | { ok: false; status: number; body: unknown; endpoint: string; reason: CloudflareApiFailureReason };

export type CloudflareListResult =
  | { ok: true; status: number; items: unknown[]; endpoint: string }
  | { ok: false; status: number; items: unknown[]; endpoint: string; reason: CloudflareApiFailureReason };

export class CloudflareApiClient {
  constructor(private readonly token: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async get(path: string, search: Record<string, string | number | boolean> = {}): Promise<CloudflareApiResult> {
    const endpoint = buildEndpoint(path, search);
    try {
      const response = await this.fetchImpl(endpoint, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.token}`
        }
      });
      const body = await readJson(response);
      if (response.ok) {
        return { ok: true, status: response.status, body, endpoint: endpoint.pathname };
      }
      return {
        ok: false,
        status: response.status,
        body,
        endpoint: endpoint.pathname,
        reason: response.status === 401 || response.status === 403 ? "permission" : "api_error"
      };
    } catch {
      return { ok: false, status: 0, body: undefined, endpoint: endpoint.pathname, reason: "network" };
    }
  }

  async list(path: string, search: Record<string, string | number | boolean> = {}): Promise<CloudflareListResult> {
    const items: unknown[] = [];
    let status = 200;
    let endpoint = path;

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const result = await this.get(path, { ...search, page });
      endpoint = result.endpoint;
      status = result.status;
      if (!result.ok) {
        return { ok: false, status, items, endpoint, reason: result.reason };
      }

      const body = asRecord(result.body);
      items.push(...arrayValue(body.result));
      const totalPages = numberValue(asRecord(body.result_info).total_pages) ?? 1;
      if (page >= totalPages) {
        return { ok: true, status, items, endpoint };
      }
    }

    return { ok: true, status, items, endpoint };
  }
}

function buildEndpoint(path: string, search: Record<string, string | number | boolean>): URL {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("://")) {
    throw new Error(`Cloudflare API path must start with a single slash: ${path}`);
  }

  const endpoint = new URL(path, CLOUDFLARE_API_BASE);
  for (const [key, value] of Object.entries(search)) {
    endpoint.searchParams.set(key, String(value));
  }
  return endpoint;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
