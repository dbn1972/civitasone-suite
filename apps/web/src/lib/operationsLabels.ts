/**
 * UAT b23: the tenant-admin operations page printed raw server text: log "source" ids like "finance-worker" and error
 * lines with absolute file paths and stack frames (/home/<user>/.../node_modules/pkg/dist/x.js:123:45). These helpers
 * turn them into readable labels. Display only: the redaction of personal data stays server-side (redactLogLine).
 */

const SOURCE_WORDS: Record<string, string> = { api: "API", db: "database", pm2: "PM2", sms: "SMS", gst: "GST", hrms: "HRMS", crm: "CRM", ai: "AI", ml: "ML", cdp: "CDP" };

/** "finance-worker" -> "Finance worker"; "gateway" -> "Gateway". */
export function operationsSourceLabel(source: string): string {
  const words = source.split(/[-_\s]+/).filter(Boolean).map((w) => SOURCE_WORDS[w.toLowerCase()] ?? w.toLowerCase());
  if (words.length === 0) return source;
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Absolute POSIX/Windows paths, with optional :line:col. node_modules paths are reduced to the package name.
const NODE_MODULES_PATH = /(?:\/[^\s()'"]+)?\/node_modules\/((?:@[^/\s]+\/)?[^/\s()'"]+)[^\s()'"]*/g;
const ABS_PATH = /(?:[A-Za-z]:\\|\/)(?:[^\s()'"\\/]+[\\/])+([^\s()'"\\/:]+)(?::\d+){0,2}/g;
// A stack frame is "at" followed by a path, or by "(path)" / "(file:line:col)", optionally after a function name. Prose such
// as "failed at step 3" or "at connect timeout" has neither and is left alone.
const STACK_FRAME = /(?:^|\s)at\s+(?:[^\s(]+\s+)?(?:\([^)]*(?:[\\/]|:\d+:\d+)[^)]*\)|(?:[A-Za-z]:\\|\/)\S*)/g;
const FALLBACK = "Error (details withheld)";

/**
 * Readable one-line summary of a log error line: stack frames removed, file paths shortened to the file name (or the
 * package name inside node_modules). If nothing readable is left (a bare stack frame) a fixed placeholder is returned, never the raw text.
 */
export function describeOperationsError(line: string): string {
  const stripped = line
    .replace(STACK_FRAME, "")
    .replace(NODE_MODULES_PATH, (_m, pkg: string) => `${pkg} package`)
    .replace(ABS_PATH, (_m, file: string) => file)
    .replace(/\s{2,}/g, " ")
    .trim();
  return stripped || FALLBACK;
}
