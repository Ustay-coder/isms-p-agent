export function logEntry(kind: string, message: string, now = new Date()): string {
  return `## [${now.toISOString()}] ${kind} | ${message}\n`;
}
