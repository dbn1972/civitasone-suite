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

describe("ecosystem scanner DSN wiring (court/visitor/works/procurement)", () => {
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

  it("wires PROCUREMENT_SCANNER_DATABASE_URL into procurement-worker", () => {
    expect(eco).toMatch(/worker\(\s*"procurement"[\s\S]*?PROCUREMENT_SCANNER_DATABASE_URL/);
    expect(eco).toContain('scannerDbUrl("procurement_scanner"');
  });
});

describe("ecosystem PII_ENC_KEY wiring (procurement) — 117-restart-loop regression", () => {
  const eco = readFileSync(join(ROOT, "ecosystem.config.js"), "utf8");

  it("generates a dedicated PROCUREMENT_PII_KEY via the piiKey() factory", () => {
    expect(eco).toMatch(/piiKey\(\s*"PROCUREMENT_PII_KEY"/);
  });

  it("wires PII_ENC_KEY into svc(\"procurement\", …) — service reads process.env.PII_ENC_KEY, not a per-service var", () => {
    const m = eco.match(/svc\(\s*"procurement"[\s\S]*?\)[,;\n]/);
    expect(m?.[0], 'svc("procurement", …) call not found').toBeDefined();
    expect(m?.[0]).toContain("PII_ENC_KEY");
  });

  it("wires PII_ENC_KEY into worker(\"procurement\", …)", () => {
    // Nested scannerDbUrl(...) — match loosely to the full call.
    const m = eco.match(/worker\(\s*"procurement"[\s\S]*?PROCUREMENT_SCANNER_DATABASE_URL[\s\S]*?\)\s*,/);
    expect(m?.[0], 'worker("procurement", …) call not found').toBeDefined();
    expect(m?.[0]).toContain("PII_ENC_KEY: PROCUREMENT_PII_KEY");
    expect(m?.[0]).toContain("PROCUREMENT_SCANNER_DATABASE_URL");
  });
});

describe("ecosystem workflow scanner DSN", () => {
  const eco = readFileSync(join(ROOT, "ecosystem.config.js"), "utf8");
  it("wires WORKFLOW_SCANNER_DATABASE_URL into workflow-worker", () => {
    expect(eco).toMatch(/worker\(\s*"workflow"[\s\S]*WORKFLOW_SCANNER_DATABASE_URL/);
    expect(eco).toContain('scannerDbUrl("workflow_scanner"');
  });
});
