/**
 * Static regression: payroll-worker's outbox relay + scheduled purge must run
 * on the BYPASSRLS scannerDb, not the tenant-scoped payroll_svc `db`. Mirrors
 * works-service / court-service / visitor-service
 * worker-relay-scanner.static.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("payroll worker outbox relay + purge use scannerDb", () => {
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

  it("does not call startOutboxPurge(db, …) for the scheduled purge", () => {
    expect(src).not.toMatch(/startOutboxPurge\(\s*db\s*,/);
    expect(src).not.toMatch(/startOutboxPurge\(\s*db\s+as unknown/);
  });

  it("wraps queue.subscribe with runWithTenant so async consumers see app.tenant_id", () => {
    expect(src).toContain("runWithTenant");
    expect(src).toMatch(/q\.subscribe\s*=/);
  });
});
