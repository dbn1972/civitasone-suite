import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("procurement worker outbox relay uses scannerDb", () => {
  const src = readFileSync(join(__dirname, "../src/worker.ts"), "utf8");

  it("imports scannerDb from shared/scanner-db.js", () => {
    expect(src).toMatch(/import\s*\{\s*scannerDb\s*\}\s*from\s*"\.\/shared\/scanner-db\.js"/);
  });

  it("calls startRelay with scannerDb", () => {
    expect(src).toMatch(/startRelay\(\s*scannerDb/);
  });

  it("does not call startRelay(db, …) for the primary relay", () => {
    expect(src).not.toMatch(/startRelay\(\s*db\s*,/);
  });

  it("calls startOutboxPurge with scannerDb", () => {
    expect(src).toMatch(/startOutboxPurge\(\s*scannerDb/);
  });

  it("wraps consumer subscriptions with runWithTenant (RLS write-path enforcement)", () => {
    expect(src).toContain("runWithTenant");
    expect(src).toMatch(/runWithTenant\(msg\.tenantId/);
  });
});
