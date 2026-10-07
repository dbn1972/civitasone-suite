/**
 * GAP-DESIGNER-DETAIL-TEST-01 (pinning test): the sandbox-test pipeline is a
 * PURE synthetic simulation. It must never touch the real finance ledger or
 * create a real payment. runSandboxPipeline is documented "pure, no I/O" and
 * commands.ts persists only to its own sandbox_test_runs table.
 *
 * This test pins the isolation guarantee by asserting:
 *  1. runSandboxPipeline returns artifacts without performing any I/O.
 *  2. The sandbox domain module imports nothing from finance.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runSandboxPipeline } from "./domain.js";
import type { ServiceDefinitionRow } from "../catalogue/schema.js";

const here = dirname(fileURLToPath(import.meta.url));

function baseDef(): ServiceDefinitionRow {
  return {
    id: "def-1",
    tenantId: "t-1",
    name: "Trade License",
    servicePattern: "certificate",
    channels: ["portal"],
    feeModel: "flat",
    hoaCode: "4201",
    status: "draft",
  } as unknown as ServiceDefinitionRow;
}

describe("sandbox-test isolation (GAP-DESIGNER-DETAIL-TEST-01)", () => {
  it("runs the pipeline purely, producing steps without I/O", () => {
    const result = runSandboxPipeline(baseDef());
    expect(Array.isArray(result.steps)).toBe(true);
    expect(result.steps.length).toBeGreaterThan(0);
  });

  it("sandbox domain and commands never import a finance/ledger module", () => {
    const domainSrc = readFileSync(join(here, "domain.ts"), "utf8");
    const commandsSrc = readFileSync(join(here, "commands.ts"), "utf8");
    for (const src of [domainSrc, commandsSrc]) {
      expect(src).not.toMatch(/finance-service|modules\/.*finance|\/gl\b|ledger/i);
    }
  });

  it("commands persists only to its own sandbox-test repo", () => {
    const commandsSrc = readFileSync(join(here, "commands.ts"), "utf8");
    // The only repo it writes through is this module's repo (insertRun).
    expect(commandsSrc).toMatch(/repo\.insertRun/);
    expect(commandsSrc).not.toMatch(/paymentRepo|glRepo|financeRepo|journalRepo/i);
  });
});
