import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * W2 PQ-C grep guard, in the style of hr/piiRawRenderGuard.test.ts. Path-scoped
 * to ai/chat, procurement/vendors and municipal: no `.tsx` there may render a
 * raw PII field (PAN / phone / email / Aadhaar / bank account, a chat message's
 * `content`, or a municipal detail entry's `rawValue`) as a JSX child or a
 * `value:` row unless the same line goes through `<Masked>`, a `mask*()`
 * helper or `maskIdentifiers`. IFSC is deliberately not matched (owner
 * decision 2026-10-14). There is no baseline file; ALLOW needs a reason.
 */
const APP_DIR = __dirname;
const PII = "(?:pan|panNo|panNumber|aadhaar\\w*|aadhar\\w*|phone|mobile|email|contactPhone|bankAccountNo|bankAccount|accountNo|accountNumber|rawValue)";
const SCOPES: { dir: string; field: string }[] = [
  { dir: "ai/chat", field: `(?:${PII}|content)` },
  { dir: "procurement/vendors", field: PII },
  { dir: "municipal", field: PII },
];
const NOT_DATA = "(?<!errors)(?<!Errors)(?<!current)";
const jsxChild = (f: string) => new RegExp(`(?:(?<!=)>|^)\\s*\\{[^<]*${NOT_DATA}\\.${f}\\b`);
const rowValue = (f: string) => new RegExp(`\\bvalue:\\s*[^,}]*${NOT_DATA}\\.${f}\\b`);
const SAFE_ON_LINE = /<Masked\b|\bmask[A-Z]\w*\(|\bmaskPii\b|\bmaskIdentifiers\(/;

/** `relative/path.tsx::<trimmed line>` -> why raw is acceptable. */
const ALLOW: Record<string, string> = {};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".tsx") && !/\.test\.tsx$/.test(e.name)) out.push(p);
  }
  return out;
}

export function findRawPiiRenders(src: string, field: string): string[] {
  const hits: string[] = [];
  const a = jsxChild(field);
  const b = rowValue(field);
  for (const raw of src.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("//") || line.startsWith("*") || line.startsWith("/*") || line.startsWith("{/*")) continue;
    if (/\bref=\{/.test(line) || /&&\s*\($/.test(line)) continue;
    if (!(a.test(line) || b.test(line))) continue;
    if (SAFE_ON_LINE.test(line)) continue;
    hits.push(line);
  }
  return hits;
}

describe("W2 PQ-C: no raw PII renders under ai/chat, procurement/vendors, municipal", () => {
  it("detector flags raw renders and accepts Masked / mask helpers", () => {
    const f = SCOPES[0]!.field;
    expect(findRawPiiRenders("<p>{entry.content}</p>", f)).toHaveLength(1);
    expect(findRawPiiRenders("<p>{maskIdentifiers(entry.content)}</p>", f)).toHaveLength(0);
    expect(findRawPiiRenders("<span>{vendor.panNo}</span>", PII)).toHaveLength(1);
    expect(findRawPiiRenders("<span>{vendor.email}</span>", PII)).toHaveLength(1);
    expect(findRawPiiRenders("<span>{vendor.bankAccountNo}</span>", PII)).toHaveLength(1);
    expect(findRawPiiRenders("<span>{entry.rawValue}</span>", PII)).toHaveLength(1);
    expect(findRawPiiRenders('<Masked value={vendor.panNo} kind="pan" />', PII)).toHaveLength(0);
    expect(findRawPiiRenders("<span>{vendor.ifscCode}</span>", PII)).toHaveLength(0);
  });

  it("every .tsx render of a PII field is masked or allow-listed with a reason", () => {
    const offenders: string[] = [];
    const used = new Set<string>();
    for (const { dir, field } of SCOPES) {
      const root = join(APP_DIR, dir);
      expect(existsSync(root)).toBe(true);
      for (const file of walk(root)) {
        const rel = relative(APP_DIR, file);
        for (const line of findRawPiiRenders(readFileSync(file, "utf8"), field)) {
          const key = `${rel}::${line}`;
          if (ALLOW[key]) used.add(key);
          else offenders.push(key);
        }
      }
    }
    expect(offenders).toEqual([]);
    expect(Object.keys(ALLOW).filter((k) => !used.has(k))).toEqual([]);
  });
});
