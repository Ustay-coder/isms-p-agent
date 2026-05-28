import type { ScanSignal } from "../schemas/scan.js";

export interface GitHubInput {
  repository: string;
  token?: string;
}

const GITHUB_API_BASE = "https://api.github.com";

export async function scanGitHub(input: GitHubInput, fetchImpl: typeof fetch = fetch): Promise<ScanSignal[]> {
  if (!input.token) {
    return [needsConfirmation("github:token", "GITHUB_TOKEN is required to scan GitHub metadata.", { repository: input.repository })];
  }

  const repository = input.repository.trim();
  const repo = await getJson(fetchImpl, `${GITHUB_API_BASE}/repos/${encodePath(repository)}`, input.token);
  if (!repo.ok) {
    return [apiUncertainty("github:repository", "repository metadata", repo.status, repository)];
  }

  const repoBody = asRecord(repo.body);
  const defaultBranch = stringValue(repoBody.default_branch) ?? "unknown";
  const visibility = stringValue(repoBody.visibility) ?? (repoBody.private === true ? "private" : "unknown");
  const signals: ScanSignal[] = [
    {
      id: "github:repository",
      source: "github",
      basis: "observed",
      summary: `GitHub repository metadata is available for ${repository}.`,
      paths: [],
      metadata: { repository, visibility, defaultBranch }
    }
  ];

  const protection = await getJson(fetchImpl, `${GITHUB_API_BASE}/repos/${encodePath(repository)}/branches/${encodePath(defaultBranch)}/protection`, input.token);
  signals.push(protection.ok || protection.status === 404
    ? {
        id: "github:default-branch-protection",
        source: "github",
        basis: "observed",
        summary: protection.ok
          ? `GitHub default branch protection is present for ${defaultBranch}.`
          : `GitHub default branch protection was not observed for ${defaultBranch}.`,
        paths: [],
        metadata: { defaultBranch, branchProtected: protection.ok }
      }
    : apiUncertainty("github:default-branch-protection", "default branch protection", protection.status, repository));

  const workflows = await getJson(fetchImpl, `${GITHUB_API_BASE}/repos/${encodePath(repository)}/actions/workflows`, input.token);
  if (workflows.ok) {
    const body = asRecord(workflows.body);
    const count = numberValue(body.total_count) ?? arrayValue(body.workflows).length;
    signals.push({
      id: "github:actions-workflows",
      source: "github",
      basis: "observed",
      summary: `GitHub Actions workflow metadata shows ${count} workflow(s).`,
      paths: [],
      metadata: { present: count > 0, workflowCount: count }
    });
  } else {
    signals.push(apiUncertainty("github:actions-workflows", "Actions workflows", workflows.status, repository));
  }

  const dependabot = await firstSuccessful(fetchImpl, input.token, [
    `${GITHUB_API_BASE}/repos/${encodePath(repository)}/contents/.github/dependabot.yml`,
    `${GITHUB_API_BASE}/repos/${encodePath(repository)}/contents/.github/dependabot.yaml`
  ]);
  signals.push(presenceSignal("github:dependabot-config", "github", "Dependabot configuration", dependabot, ".github/dependabot.yml"));

  const codeowners = await firstSuccessful(fetchImpl, input.token, [
    `${GITHUB_API_BASE}/repos/${encodePath(repository)}/contents/.github/CODEOWNERS`,
    `${GITHUB_API_BASE}/repos/${encodePath(repository)}/contents/CODEOWNERS`,
    `${GITHUB_API_BASE}/repos/${encodePath(repository)}/contents/docs/CODEOWNERS`
  ]);
  signals.push(presenceSignal("github:codeowners", "github", "CODEOWNERS", codeowners, ".github/CODEOWNERS"));

  return signals;
}

async function firstSuccessful(fetchImpl: typeof fetch, token: string, urls: string[]): Promise<ApiResult> {
  let last: ApiResult = { ok: false, status: 404, body: undefined };
  for (const url of urls) {
    const result = await getJson(fetchImpl, url, token);
    if (result.ok || result.status !== 404) {
      return result;
    }
    last = result;
  }
  return last;
}

function presenceSignal(id: string, source: "github", label: string, result: ApiResult, defaultPath: string): ScanSignal {
  if (result.ok || result.status === 404) {
    return {
      id,
      source,
      basis: "observed",
      summary: result.ok ? `${label} is present.` : `${label} was not observed.`,
      paths: result.ok ? [defaultPath] : [],
      metadata: { present: result.ok }
    };
  }
  return apiUncertainty(id, label, result.status, "");
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
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28"
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

function apiUncertainty(id: string, label: string, status: number, repository: string): ScanSignal {
  const statusText = status === 0 ? "network error" : `${status}`;
  return needsConfirmation(id, `GitHub API returned ${statusText} while checking ${label}.`, repository ? { repository } : {});
}

function needsConfirmation(id: string, summary: string, metadata: Record<string, string | number | boolean | string[]>): ScanSignal {
  return { id, source: "github", basis: "needs_confirmation", summary, paths: [], metadata };
}

function encodePath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
