import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { rupeesToMinorString, percentToBps } from "@/lib/money";

/**
 * Guard (docs/gap-closure/w0-report.md, revenue money): no float rupee->paise
 * conversion in the revenue module. Use rupeesToMinorString / percentToBps from
 * "@/lib/money" (string parse, exact) instead of `Number(x) * 100`.
 */
const ROOT = __dirname;
const FLOAT_MONEY = /(?:Number|parseFloat|parseInt)\([^)\n]*\)\s*\*\s*100\b|Math\.round\([^)\n]*\*\s*100\)|\bn\s*\*\s*100\b/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("revenue money conversion guard", () => {
  it("has no float `*100` money conversion in revenue sources", () => {
    const offenders = sources(ROOT).flatMap((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .map((line, i) => ({ f, i: i + 1, line }))
        .filter(({ line }) => !line.trim().startsWith("*") && !line.trim().startsWith("//") && FLOAT_MONEY.test(line))
        .map(({ f: file, i, line }) => `${file}:${i}: ${line.trim()}`),
    );
    expect(offenders).toEqual([]);
  });
});

describe("shared paise parser used by revenue forms", () => {
  it.each([
    ["1.15", "115"],
    ["0.07", "7"],
    ["1234567.89", "123456789"],
  ])("rupeesToMinorString(%j) is exact", (input, expected) => {
    expect(rupeesToMinorString(input)).toBe(expected);
  });
  it.each(["", "abc", "1.005", "-1", "0"])("rupeesToMinorString(%j) -> null", (input) => {
    expect(rupeesToMinorString(input)).toBeNull();
  });
  it("percentToBps is exact for 5.55 and 0.07", () => {
    expect(percentToBps("5.55")).toBe(555);
    expect(percentToBps("0.07")).toBe(7);
    expect(percentToBps("abc")).toBeNull();
  });
});
