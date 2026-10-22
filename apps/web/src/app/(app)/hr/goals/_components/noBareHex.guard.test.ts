import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// GAP-HR-GOALS-05 acceptance 2: "grep for '#[0-9a-f]{3,6}' outside var()
// fallbacks returns nothing in goals/_components". Colours in these components
// come from theme tokens so they follow the dark theme; a hex literal is only
// tolerated as the fallback argument of var(--token, #hex).
const DIR = __dirname;

function sourceFiles(): string[] {
  return readdirSync(DIR).filter((f) => /\.(tsx?|css)$/.test(f) && !/\.test\.tsx?$/.test(f));
}

describe("goals/_components colour tokens (GAP-HR-GOALS-05)", () => {
  it.each(sourceFiles())("%s has no bare hex colour outside a var() fallback", (file) => {
    const withoutFallbacks = readFileSync(join(DIR, file), "utf8").replace(/var\(\s*--[\w-]+\s*,\s*#[0-9a-fA-F]{3,8}\s*\)/g, "var(--x)");
    const hits = withoutFallbacks.split("\n").flatMap((line, i) => (/#[0-9a-fA-F]{3,8}\b/.test(line) ? [`${file}:${i + 1}: ${line.trim()}`] : []));
    expect(hits).toEqual([]);
  });

  it("scans the three components the item names", () => {
    expect(sourceFiles()).toEqual(expect.arrayContaining(["GoalsProgressRing.tsx", "GoalTrackerCard.tsx", "DevelopmentPlanTimeline.tsx"]));
  });
});
