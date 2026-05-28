import type { ScanSignal } from "../schemas/scan.js";

export interface VercelInput {
  project: string;
  token?: string;
}

const VERCEL_API_BASE = "https://api.vercel.com";

export async function scanVercel(input: VercelInput, fetchImpl: typeof fetch = fetch): Promise<ScanSignal[]> {
  if (!input.token) {
    return [needsConfirmation("vercel:token", "VERCEL_TOKEN is required to scan Vercel metadata.", { project: input.project })];
  }

  const project = input.project.trim();
  const projectResult = await getJson(fetchImpl, `${VERCEL_API_BASE}/v9/projects/${encodeURIComponent(project)}`, input.token);
  if (!projectResult.ok) {
    return [apiUncertainty("vercel:project", "project metadata", projectResult.status, project)];
  }

  const signals: ScanSignal[] = [{
    id: "vercel:project",
    source: "vercel",
    basis: "observed",
    summary: `Vercel project metadata is available for ${project}.`,
    paths: [],
    metadata: { project, exists: true }
  }];

  const domains = await getJson(fetchImpl, `${VERCEL_API_BASE}/v9/projects/${encodeURIComponent(project)}/domains`, input.token);
  if (domains.ok) {
    const count = arrayValue(asRecord(domains.body).domains).length;
    signals.push({
      id: "vercel:production-domains",
      source: "vercel",
      basis: "observed",
      summary: `Vercel project has ${count} configured domain(s).`,
      paths: [],
      metadata: { present: count > 0, domainCount: count }
    });
  } else {
    signals.push(apiUncertainty("vercel:production-domains", "project domains", domains.status, project));
  }

  const projectId = stringValue(asRecord(projectResult.body).id) ?? project;
  const deployments = await getJson(fetchImpl, `${VERCEL_API_BASE}/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=1`, input.token);
  if (deployments.ok) {
    const latest = asRecord(arrayValue(asRecord(deployments.body).deployments)[0]);
    const state = stringValue(latest.state) ?? "unknown";
    const target = stringValue(latest.target) ?? "unknown";
    signals.push({
      id: "vercel:latest-deployment",
      source: "vercel",
      basis: "observed",
      summary: `Vercel latest deployment state is ${state}.`,
      paths: [],
      metadata: { state, target }
    });
  } else {
    signals.push(apiUncertainty("vercel:latest-deployment", "deployments", deployments.status, project));
  }

  const env = await getJson(fetchImpl, `${VERCEL_API_BASE}/v10/projects/${encodeURIComponent(project)}/env`, input.token);
  if (env.ok) {
    const envVarNames = arrayValue(asRecord(env.body).envs)
      .map((item) => stringValue(asRecord(item).key))
      .filter((value): value is string => value !== undefined)
      .sort();
    signals.push({
      id: "vercel:environment-variables",
      source: "vercel",
      basis: "observed",
      summary: `Vercel project has ${envVarNames.length} environment variable name(s).`,
      paths: [],
      metadata: { envVarCount: envVarNames.length, envVarNames }
    });
  } else {
    signals.push(apiUncertainty("vercel:environment-variables", "environment variables", env.status, project));
  }

  return signals;
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

function apiUncertainty(id: string, label: string, status: number, project: string): ScanSignal {
  const statusText = status === 0 ? "network error" : `${status}`;
  return needsConfirmation(id, `Vercel API returned ${statusText} while checking ${label}.`, { project });
}

function needsConfirmation(id: string, summary: string, metadata: Record<string, string | number | boolean | string[]>): ScanSignal {
  return { id, source: "vercel", basis: "needs_confirmation", summary, paths: [], metadata };
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
