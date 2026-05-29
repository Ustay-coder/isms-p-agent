export const CLOUDFLARE_PRODUCTS = ["zone", "access", "waf", "dns", "workers", "r2", "hyperdrive", "api-gateway"] as const;
export type CloudflareProduct = typeof CLOUDFLARE_PRODUCTS[number];

export const DEFAULT_CLOUDFLARE_PRODUCTS: CloudflareProduct[] = ["zone", "waf", "access", "dns"];
export const ACCOUNT_CLOUDFLARE_PRODUCTS: CloudflareProduct[] = ["workers", "r2", "hyperdrive", "api-gateway"];

export function parseCloudflareProducts(value: string): CloudflareProduct[] | undefined {
  const rawParts = value.split(",");
  const parts = rawParts.map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length === 0 || parts.length !== rawParts.length) {
    return undefined;
  }

  const products: CloudflareProduct[] = [];
  for (const part of parts) {
    if (!isCloudflareProduct(part)) {
      return undefined;
    }
    products.push(part);
  }
  return products;
}

export function normalizeCloudflareProducts(products: CloudflareProduct[] | undefined): CloudflareProduct[] {
  const selected = products && products.length > 0 ? products : DEFAULT_CLOUDFLARE_PRODUCTS;
  const normalized: CloudflareProduct[] = [];
  for (const product of selected) {
    if (!normalized.includes(product)) {
      normalized.push(product);
    }
  }
  return normalized;
}

export function isAccountCloudflareProduct(product: CloudflareProduct): boolean {
  return ACCOUNT_CLOUDFLARE_PRODUCTS.includes(product);
}

function isCloudflareProduct(value: string): value is CloudflareProduct {
  return (CLOUDFLARE_PRODUCTS as readonly string[]).includes(value);
}
