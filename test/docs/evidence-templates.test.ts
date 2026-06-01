import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const templatePaths = [
  "docs/evidence-templates/cloudflare/ISMS-P-2.10.2-cloud-admin-access-review.md",
  "docs/evidence-templates/cloudflare/ISMS-P-2.10.2-cloud-change-approval.md",
  "docs/evidence-templates/cloudflare/ISMS-P-2.10.2-cloud-security-review.md"
];

const requiredText = [
  "# Cloudflare",
  "## Requirement",
  "## Purpose",
  "Accepted Criteria",
  "Private Storage",
  "Public Export Rule",
  "Review Command",
  "evidence/private/ISMS-P-2.10.2",
  "ismsp evidence review"
];

const unsafeExamples = [
  /\bcfat_[A-Za-z0-9_-]+/i,
  /\btoken\s*[:=]/i,
  /\baccount[_ -]?id\s*[:=]/i,
  /\bzone[_ -]?id\s*[:=]/i
];

test("Cloudflare accepted evidence templates define private review criteria", async () => {
  for (const templatePath of templatePaths) {
    const content = await readFile(join(process.cwd(), templatePath), "utf8");

    for (const text of requiredText) {
      assert.match(content, new RegExp(escapeRegExp(text)), `${templatePath} should include ${text}`);
    }
  }
});

test("Cloudflare accepted evidence templates do not include secret-like assignments", async () => {
  for (const templatePath of templatePaths) {
    const content = await readFile(join(process.cwd(), templatePath), "utf8");

    for (const pattern of unsafeExamples) {
      assert.doesNotMatch(content, pattern, `${templatePath} should not include ${pattern}`);
    }
  }
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
