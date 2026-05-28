export type SignalBasis = "observed" | "document-backed" | "inferred" | "needs_confirmation";

export interface ScanSignal {
  id: string;
  source: "local-repo" | "local-docs" | "github" | "vercel" | "cloudflare";
  basis: SignalBasis;
  summary: string;
  paths: string[];
  metadata: Record<string, string | number | boolean | string[]>;
}

export interface ScanResult {
  schemaVersion: 1;
  generatedAt: string;
  signals: ScanSignal[];
}
