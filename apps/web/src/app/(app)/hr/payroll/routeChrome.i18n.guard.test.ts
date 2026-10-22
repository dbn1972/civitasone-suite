import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * GAP-PAYROLL-SALARY-SLIPS-06 guard. Path-scoped, no baseline.
 *
 * Every payroll route-error boundary (error.tsx) must hand RouteError an already-
 * translated `backLabel` and `area` (t(...) from next-intl), never an English
 * literal -- a Hindi user must not get "Back to Payroll" on a failed page. And no
 * payroll loading.tsx may use a hard-coded Tailwind slate / full-viewport shell
 * (it ignores dark mode and flashes grey): skeletons use the DS tokens.
 */
const PAYROLL = __dirname;

function walk(dir: string, name: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, name));
    else if (entry === name) out.push(full);
  }
  return out;
}

const rel = (f: string) => path.relative(PAYROLL, f).split(path.sep).join("/");

/** Source with comments removed, so a rationale comment that names a class can't trip the scan. */
function code(file: string): string {
  return readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("payroll error.tsx boundaries pass translated chrome, not English literals", () => {
  const files = walk(PAYROLL, "error.tsx");

  it("finds the payroll boundaries (guards against an empty glob)", () => {
    expect(files.length).toBeGreaterThanOrEqual(40);
  });

  it.each(files.map((f) => [rel(f), f]))("%s: backLabel and area are expressions, never string literals", (_name, file) => {
    const src = code(file);
    expect(src).not.toMatch(/\bbackLabel\s*=\s*"/);
    expect(src).not.toMatch(/\bbackLabel\s*=\s*\{\s*["'`]/);
    expect(src).not.toMatch(/\barea\s*=\s*"/);
    expect(src).not.toMatch(/\barea\s*=\s*\{\s*["'`]/);
  });

  it.each(files.map((f) => [rel(f), f]))("%s: reads its copy through next-intl", (_name, file) => {
    expect(code(file)).toMatch(/useTranslations\(/);
  });
});

describe("payroll loading.tsx skeletons use DS tokens, not a hard-coded slate shell", () => {
  const files = walk(PAYROLL, "loading.tsx");

  it("finds the payroll loading files", () => {
    expect(files.length).toBeGreaterThanOrEqual(20);
  });

  it.each(files.map((f) => [rel(f), f]))("%s", (_name, file) => {
    const src = code(file);
    expect(src).not.toMatch(/\b(?:bg|text|border)-slate-\d/);
    expect(src).not.toMatch(/\bmin-h-screen\b/);
    expect(src).not.toMatch(/\bmax-w-7xl\b/);
  });
});
