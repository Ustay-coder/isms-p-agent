import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const files = [...new Set([...tracked, ...untracked])];

const forbiddenRootPaths = [
  /^raw\//,
  /^wiki\//,
  /^controls\//,
  /^project\//,
  /^connectors\//,
  /^scans\//,
  /^reports\//,
  /^reviews\//,
  /^evidence\//,
  /^AGENTS\.md$/,
  /^isms-agent\.config\.json$/,
  /^log\.md$/,
];

const contentPatterns = [
  { name: 'Stripe-like secret key', pattern: /sk_(?:live|test)_[A-Za-z0-9_]+/g },
  { name: 'Cloudflare API token', pattern: /cfat_[A-Za-z0-9_-]+/g },
  { name: 'AWS access key id', pattern: /AKIA[0-9A-Z]{16}/g },
  { name: 'GitHub personal access token', pattern: /(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}/g },
  { name: 'Google API key', pattern: /AIza[A-Za-z0-9_-]{20,}/g },
  { name: 'Slack token', pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { name: 'private key block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: 'local absolute user path', pattern: /\/Users\/[^\s)"'`]+/g },
  { name: 'private dogfood service name', pattern: /\bevaluate\.club\b/gi },
  { name: 'private dogfood account name', pattern: /\btoothy\b/gi },
  { name: 'private dogfood user id', pattern: /\bjeean0668\b/gi },
];

const findings = [];

for (const file of files) {
  if (forbiddenRootPaths.some((pattern) => pattern.test(file))) {
    findings.push({ file, issue: 'tracked private workspace artifact path' });
    continue;
  }

  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  for (const { name, pattern } of contentPatterns) {
    pattern.lastIndex = 0;
    const matches = [...text.matchAll(pattern)];
    for (const match of matches) {
      const before = text.slice(0, match.index);
      const line = before.split(/\r?\n/).length;
      findings.push({ file, line, issue: name, match: match[0] });
    }
  }
}

if (findings.length > 0) {
  console.error('Public safety scan failed:');
  for (const finding of findings) {
    const location = finding.line ? `${finding.file}:${finding.line}` : finding.file;
    console.error(`- ${location}: ${finding.issue}`);
  }
  process.exit(1);
}

console.log(`Public safety scan passed for ${files.length} git-visible release files.`);
