import type { ScanSignal } from "../schemas/scan.js";

export const CLOUDFLARE_REQUIREMENTS = {
  configExport: "ISMS-P-2.10.2.cloudflare-config-export",
  adminAccessReview: "ISMS-P-2.10.2.cloud-admin-access-review",
  changeApproval: "ISMS-P-2.10.2.cloud-change-approval"
} as const;

export type SafeCloudflareMetadataValue = string | number | boolean | string[];
export type SafeCloudflareMetadata = Record<string, SafeCloudflareMetadataValue>;

export function cloudflareObserved(id: string, summary: string, metadata: SafeCloudflareMetadata): ScanSignal {
  return { id, source: "cloudflare", basis: "observed", summary, paths: [], metadata: withDefaults(id, metadata) };
}

export function cloudflareNeedsConfirmation(id: string, summary: string, metadata: SafeCloudflareMetadata): ScanSignal {
  return { id, source: "cloudflare", basis: "needs_confirmation", summary, paths: [], metadata: withDefaults(id, metadata) };
}

export function permissionMetadata(product: string, endpoint: string, requirementIds: string[]): SafeCloudflareMetadata {
  return {
    product,
    endpoint,
    permission_status: "needs_permission_or_confirmation",
    requirement_ids: requirementIds,
    sensitivity: "internal"
  };
}

function withDefaults(id: string, metadata: SafeCloudflareMetadata): SafeCloudflareMetadata {
  return {
    snapshot_id: id,
    sensitivity: "internal",
    ...metadata
  };
}
