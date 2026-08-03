import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MOD = join(__dirname, "../src/modules");

const TARGETS = [
  "deals/tenders-routes.ts",
  "activities/next-action-routes.ts",
  "activities/recurring-routes.ts",
  "accounts/plans-routes.ts",
  "accounts/qbr-routes.ts",
  "activities/capture-routes.ts",
  "dashboard/campaign-roi-routes.ts",
];

describe("F3 P0 residual CRM CQRS", () => {
  it("target routes have zero sync writes and no 201", () => {
    const offenders: string[] = [];
    for (const rel of TARGETS) {
      const src = readFileSync(join(MOD, rel), "utf8");
      if (/await\s+db\.transaction/.test(src) || /code\(201\)/.test(src)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("residual consumer markProcessed for INSERT topics", () => {
    const src = readFileSync(join(MOD, "residual-f3/consumer.ts"), "utf8");
    expect(src).toContain("markProcessed");
    expect(src).toContain("createTender");
    expect(src).toContain("captureActivity");
    expect(src).toContain("upsertCampaignPerformance");
  });
});
