export interface ScanPathFilter {
  include?: string[];
  exclude?: string[];
}

export function pathMatchesFilter(relativePath: string, filter: ScanPathFilter = {}): boolean {
  const includePaths = normalizeFilterPaths(filter.include ?? []);
  const excludePaths = normalizeFilterPaths(filter.exclude ?? []);
  const normalizedPath = normalizeFilterPath(relativePath);

  if (includePaths.length > 0 && !includePaths.some((path) => matchesPrefix(normalizedPath, path))) {
    return false;
  }

  return !excludePaths.some((path) => matchesPathOrSegment(normalizedPath, path));
}

export function normalizeFilterPaths(paths: string[]): string[] {
  return paths
    .flatMap((path) => path.split(","))
    .map((path) => normalizeFilterPath(path))
    .filter(Boolean);
}

function normalizeFilterPath(path: string): string {
  return path
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}

function matchesPrefix(relativePath: string, filterPath: string): boolean {
  return relativePath === filterPath || relativePath.startsWith(`${filterPath}/`);
}

function matchesPathOrSegment(relativePath: string, filterPath: string): boolean {
  return relativePath === filterPath ||
    relativePath.startsWith(`${filterPath}/`) ||
    (!filterPath.includes("/") && relativePath.split("/").includes(filterPath));
}
