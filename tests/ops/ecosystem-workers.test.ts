/**
 * Ecosystem worker regression locks (court / visitor / works).
 *
 * CI: Architecture Guard job (.github/workflows/ci.yml arch-guard)
 *     runs: pnpm exec vitest run tests/ops/ecosystem-workers.test.ts
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const eco = readFileSync(join(ROOT, "ecosystem.config.js"), "utf8");
const courtPkg = JSON.parse(
  readFileSync(join(ROOT, "services/court-service/package.json"), "utf8"),
);

describe("ecosystem workers (FE↔BE CQRS)", () => {
  it("points court worker at dist/worker-main.js", () => {
    // Nested scannerDbUrl(...) args — match the full court worker(...) call loosely.
    const m = eco.match(/worker\(\s*"court"[\s\S]*?dist\/worker-main\.js"\s*\)/);
    expect(m?.[0], 'court must declare worker("court", …, "dist/worker-main.js")').toBeDefined();
    expect(m?.[0]).toContain("dist/worker-main.js");
    expect(m?.[0]).not.toMatch(/worker\(\s*"court"[\s\S]*"dist\/worker\.js"\s*\)/);
  });

  it("does not point court worker at bare dist/worker.js", () => {
    const m = eco.match(/worker\("court"[^)]*\)/);
    expect(m?.[0]).toBeDefined();
    expect(m?.[0]).not.toMatch(/"dist\/worker\.js"/);
  });

  it("declares visitor-worker and works-worker", () => {
    expect(eco).toMatch(/worker\("visitor"/);
    expect(eco).toMatch(/worker\("works"/);
  });

  it("court package.json worker script references worker-main", () => {
    expect(courtPkg.scripts?.worker).toContain("worker-main");
  });
});

describe("ecosystem scanner DSN wiring (court/visitor/works)", () => {
  const eco = readFileSync(join(ROOT, "ecosystem.config.js"), "utf8");

  it("wires COURT_SCANNER_DATABASE_URL into court-worker", () => {
    expect(eco).toMatch(/worker\(\s*"court"[\s\S]*COURT_SCANNER_DATABASE_URL/);
    expect(eco).toContain('scannerDbUrl("court_scanner"');
  });

  it("wires VISITOR_SCANNER_DATABASE_URL into visitor-worker", () => {
    expect(eco).toMatch(/worker\(\s*"visitor"[\s\S]*VISITOR_SCANNER_DATABASE_URL/);
    expect(eco).toContain('scannerDbUrl("visitor_scanner"');
  });

  it("wires WORKS_SCANNER_DATABASE_URL into works-worker", () => {
    expect(eco).toMatch(/worker\(\s*"works"[\s\S]*WORKS_SCANNER_DATABASE_URL/);
    expect(eco).toContain('scannerDbUrl("works_scanner"');
  });
});
