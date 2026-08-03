import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MODULES = join(__dirname, "../src/modules");

function routeFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name === "routes.ts" || name.endsWith("-routes.ts") || name.endsWith("-route.ts")) out.push(p);
    }
  };
  walk(MODULES);
  return out;
}

describe("F3 leftover hrms CQRS route boundary", () => {
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

  it("leave cancel publishes via sendAccepted", () => {
    const src = readFileSync(join(MODULES, "leave/cancel-route.ts"), "utf8");
    expect(src).toContain("sendAccepted");
    expect(src).toContain("commands.cancelLeave");
    expect(src).not.toContain("db.transaction");
  });

  it("f3 leftover consumers are registered", () => {
    const worker = readFileSync(join(__dirname, "../src/worker.ts"), "utf8");
    expect(worker).toContain("registerF3LeftoverAll");
    const topics = readFileSync(join(__dirname, "../src/topics.ts"), "utf8");
    expect(topics).toContain("f3RouteWrite");
    expect(topics).toContain("leaveCancel");
  });
});
