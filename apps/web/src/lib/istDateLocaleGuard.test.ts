import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// SF-07b: a date/time `toLocale(Date|Time)String` / date-option `toLocaleString`
// outside lib/formatters.ts either carries no timeZone (server and browser
// disagree, UTC hosts show the wrong IST day) or hand-rolls its own IST pin.
// Use formatIndianDate / formatIndianDateTime / formatDateTimeIST /
// formatInIST / formatMonthYear / istDateKey from @/lib/formatters instead.
//
// Number formatting (`n.toLocaleString("en-IN")` for money and counts) is not
// a date call and is not matched. There is deliberately no allow-list and no
// baseline: the only exempt file is lib/formatters.ts itself.

const SRC = join(__dirname, "..");
const ROOTS = [join(SRC, "app"), join(SRC, "lib")];
const EXEMPT = new Set(["lib/formatters.ts"]);

const DATE_ONLY_CALL = /\.toLocale(?:Date|Time)String\s*\(/;
const TO_LOCALE_STRING_ARGS = /\.toLocaleString\s*\(([^)]*)\)/g;
const DATE_OPTION_KEY = /\b(?:dateStyle|timeStyle|hour12?|minute|second|weekday|timeZone|month|day|year)\b\s*:/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function offendersIn(source: string): string[] {
  const found: string[] = [];
  source.split("\n").forEach((line, i) => {
    if (DATE_ONLY_CALL.test(line)) found.push(`${i + 1}: ${line.trim()}`);
  });
  for (const m of source.matchAll(TO_LOCALE_STRING_ARGS)) {
    if (DATE_OPTION_KEY.test(m[1])) {
      const line = source.slice(0, m.index).split("\n").length;
      found.push(`${line}: .toLocaleString(${m[1].trim().slice(0, 60)}...)`);
    }
  }
  return found;
}

describe("IST date locale guard", () => {
  it("matcher flags date calls and ignores number formatting", () => {
    expect(offendersIn('d.toLocaleDateString("en-IN")')).toHaveLength(1);
    expect(offendersIn('d.toLocaleTimeString("en-IN", { hour: "2-digit" })')).toHaveLength(1);
    expect(offendersIn('d.toLocaleString("en-IN", { dateStyle: "medium" })')).toHaveLength(1);
    expect(offendersIn('d.toLocaleString("en", {\n month: "short",\n year: "2-digit" })')).toHaveLength(1);
    expect(offendersIn('n.toLocaleString("en-IN")')).toEqual([]);
    expect(offendersIn('n.toLocaleString("en-IN", { maximumFractionDigits: 2, style: "currency" })')).toEqual([]);
  });

  it("no date/time toLocale*String outside lib/formatters.ts in src/app and src/lib", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of walk(root)) {
        const rel = relative(SRC, file);
        if (EXEMPT.has(rel)) continue;
        for (const hit of offendersIn(readFileSync(file, "utf8"))) offenders.push(`${rel}:${hit}`);
      }
    }
    expect(offenders, `use the IST formatters in @/lib/formatters:\n${offenders.join("\n")}`).toEqual([]);
  });
});
