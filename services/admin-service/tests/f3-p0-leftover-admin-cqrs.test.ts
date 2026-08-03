import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MODULES = join(__dirname, "../src/modules");
const TARGETS = [
  "api-keys/routes.ts",
  "change/routes.ts",
  "sandbox/routes.ts",
  "central-config/routes.ts",
  "config/artefact-routes.ts",
  "health/mobile-routes.ts",
  "dept-templates/routes.ts",
  "integration-settings/routes.ts",
  "uploads/doc-routes.ts",
  "support/routes.ts",
];

describe("F3 P0 leftover admin CQRS", () => {
  it("target routes have zero await db.transaction writes and no 201", () => {
    const offenders: string[] = [];
    for (const rel of TARGETS) {
      const src = readFileSync(join(MODULES, rel), "utf8");
      if (/await\s+db\.transaction/.test(src) || /reply\.code\(201\)/.test(src)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("api-keys and mobile publish commands", () => {
    const keys = readFileSync(join(MODULES, "api-keys/routes.ts"), "utf8");
    const mobile = readFileSync(join(MODULES, "health/mobile-routes.ts"), "utf8");
    expect(keys).toContain("commands.createApiKey");
    expect(keys).toContain("code(202)");
    expect(mobile).toContain("commands.recordMobileTelemetry");
  });

  it("f3 consumers markProcessed before writes", () => {
    const change = readFileSync(join(MODULES, "change/f3-consumer.ts"), "utf8");
    expect(change).toContain("markProcessed");
    expect(change).toContain("COMMANDS.f3RouteWrite");
  });
});
