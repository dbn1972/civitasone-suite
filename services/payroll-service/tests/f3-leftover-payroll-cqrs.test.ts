import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MODULES = join(__dirname, "../src/modules");

function routeFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name === "routes.ts" || name.endsWith("-routes.ts")) out.push(p);
    }
  };
  walk(MODULES);
  return out;
}

describe("F3 leftover payroll CQRS route boundary", () => {
  it("all module routes have zero sync Drizzle writes / db.transaction", () => {
    const offenders: string[] = [];
    for (const file of routeFiles()) {
      const src = readFileSync(file, "utf8");
      if (/\b(?:db|tx)\.(?:insert|update|delete)\s*\(/.test(src) || /db\.transaction/.test(src)) {
        offenders.push(file.replace(MODULES + "/", ""));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("challan ingest validates with zod and publishes via sendAccepted", () => {
    const src = readFileSync(join(MODULES, "statutory-returns/challan-routes.ts"), "utf8");
    expect(src).toContain("challanBodySchema.parse(req.body)");
    expect(src).toContain("challanCommands.ingestChallan");
    expect(src).toContain("sendAccepted");
    expect(src).not.toContain("req.body as");
  });

  it("dsc and sponsor config mutations publish commands", () => {
    const dsc = readFileSync(join(MODULES, "dsc-config/routes.ts"), "utf8");
    const sponsor = readFileSync(join(MODULES, "sponsor-config/routes.ts"), "utf8");
    expect(dsc).toContain("commands.upsertDscConfig");
    expect(dsc).toContain("commands.removeDscConfig");
    expect(dsc).toContain("sendAccepted");
    expect(sponsor).toContain("commands.upsertSponsorConfig");
    expect(sponsor).toContain("sendAccepted");
  });

  it("challan consumer markProcessed precedes insert", () => {
    const src = readFileSync(join(MODULES, "statutory-returns/challan-consumer.ts"), "utf8");
    expect(src.indexOf("markProcessed")).toBeLessThan(src.indexOf(".insert(payrollTdsChallan)"));
  });
});
