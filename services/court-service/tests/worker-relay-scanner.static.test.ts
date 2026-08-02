/**
 * Static regression: court-worker's outbox relay + scheduled purge must run
 * on the BYPASSRLS scannerDb, not the tenant-scoped court_svc `db`. Mirrors
 * visitor-service's worker-relay-scanner.static.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("court worker outbox relay + purge use scannerDb", () => {
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
});
