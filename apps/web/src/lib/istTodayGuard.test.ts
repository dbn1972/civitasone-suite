import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// SF-07: `new Date().toISOString().slice(0, 10)` is "today" in UTC, which is
// yesterday between 00:00 and 05:30 IST. App code must use todayIST() /
// addDaysIST() from @/lib/formatters instead.
//
// Allow-list: path (relative to src/app) -> why a UTC day is genuinely wanted.
// Currently empty; add an entry here only with a stated reason.
const ALLOWED: Record<string, string> = {};

const APP_DIR = join(__dirname, "..", "app");
const UTC_TODAY = /new Date\(\)\s*\.toISOString\(\)\s*\.slice\(\s*0\s*,\s*10\s*\)/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

describe("IST today guard", () => {
  it("no UTC-based today (new Date().toISOString().slice(0, 10)) in src/app", () => {
    const offenders = walk(APP_DIR)
      .map((f) => relative(APP_DIR, f))
      .filter((rel) => !(rel in ALLOWED))
      .filter((rel) => UTC_TODAY.test(readFileSync(join(APP_DIR, rel), "utf8")));
    expect(offenders, `use todayIST() from @/lib/formatters instead:\n${offenders.join("\n")}`).toEqual([]);
  });
});
