import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * SF-13 guard: no quoted hex colour literal (style props, template strings,
 * fallbacks like `var(--bad, #c0392b)`) in the paths that have been cleaned onto
 * the theme tokens / ds/Alert. Scoped to those paths only; each later SF-13
 * slice appends the directories it finishes. There is no baseline: a listed
 * path must be completely clean.
 */
const APP = join(__dirname, "..", "..");

const CLEANED: readonly string[] = [
  "_components/ds/Alert.tsx",
  "_components/UsageWarningBanner.tsx",
  "(app)/assets/AccountingBanner.tsx",
  "(app)/finance/budget",
  "(app)/finance/chart-of-accounts",
  "(app)/finance/debt",
  "(app)/finance/gst",
  "(app)/finance/journal-entry",
  "(app)/finance/config",
  "(app)/finance/payments",
  "(app)/finance/pfms",
  "(app)/finance/revenue",
  "(app)/finance/statutory",
  "(app)/finance/treasury",
  "(app)/finance/vendors",
  "(app)/finance/accounting",
  "(app)/finance/audit-paras",
  "(app)/finance/dashboard",
  "(app)/finance/expenditure",
  "(app)/finance/fiscal-years",
  "(app)/finance/opening-balances",
  "(app)/finance/period-close",
  "(app)/finance/reconciliation",
  "(app)/finance/recurring-entries",
  "(app)/ai",
  "(app)/approvals",
  "(app)/audit",
  "(app)/billing",
  "(app)/catalogue",
  "(app)/cdp",
  "(app)/change",
  "(app)/contracts",
  "(app)/court",
  "(app)/dashboard",
  "(app)/developer-portal",
  "(app)/documents",
  "(app)/domains",
  "(app)/establishment",
  "(app)/field",
  "(app)/fleet",
  "(app)/grants",
  "(app)/help",
  "(app)/helpdesk",
  "(app)/identity",
  "(app)/inspection",
  "(app)/install",
  "(app)/inventory",
  "(app)/journeys",
  "(app)/learning",
  "(app)/legal",
  "(app)/library",
  "(app)/locations",
  "(app)/loyalty",
  "(app)/meeting",
  "(app)/metadata",
  "(app)/municipal",
  "(app)/notifications",
  "(app)/policy",
  "(app)/procurement",
  "(app)/projects",
  "(app)/reports",
  "(app)/revenue",
  "(app)/settings",
  "(app)/setup",
  "(app)/stock",
  "(app)/telephony",
  "(app)/tenant",
  "(app)/themes",
  "(app)/visitor",
  "(app)/workflow",
];

function walk(p: string): string[] {
  if (statSync(p).isFile()) return [p];
  return readdirSync(p).flatMap((n) => walk(join(p, n)));
}

const HEX_IN_STRING = /(["'`])(?:(?!\1)[^\n])*?(#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4}))\b/;

function offenders(src: string): string[] {
  const out: string[] = [];
  src.split("\n").forEach((line, i) => {
    const m = HEX_IN_STRING.exec(line);
    if (!m) return;
    // 3-4 digit all-numeric tokens are issue references ("PR #1565"), not colours.
    if (/^#\d{3,4}$/.test(m[2]!) && !/^["'`]#/.test(m[0].slice(m[0].length - m[2]!.length - 1))) return;
    out.push(`${i + 1}: ${line.trim().slice(0, 120)}`);
  });
  return out;
}

describe("SF-13 guard: no inline hex colours in cleaned paths", () => {
  it("detects a quoted hex colour (self-check)", () => {
    expect(offenders(`const s = { color: "#b91c1c" };`)).toHaveLength(1);
    expect(offenders("const s = `1px solid #e5e7eb`;")).toHaveLength(1);
    expect(offenders(`color: "var(--bad, #c0392b)"`)).toHaveLength(1);
    expect(offenders(`const s = { color: "var(--bad)" };`)).toHaveLength(0);
    expect(offenders(`const note = "fixed in PR #1565";`)).toHaveLength(0);
  });

  for (const rel of CLEANED) {
    it(`${rel} has no quoted hex colour`, () => {
      const files = walk(join(APP, rel)).filter((f) => /\.(tsx?|css)$/.test(f) && !/\.test\.tsx?$/.test(f));
      expect(files.length).toBeGreaterThan(0);
      const bad = files.flatMap((f) => offenders(readFileSync(f, "utf8")).map((o) => `${relative(APP, f)}:${o}`));
      expect(bad).toEqual([]);
    });
  }
});
