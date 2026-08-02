/**
 * Static regression: workflow-worker must NOT reintroduce the old custom
 * per-tenant relay/purge loop (relayAllTenantsOnce / purgeAllTenantsOnce,
 * looping runWithTenant() over workflow.outbox_pending_tenants() /
 * outbox_purgeable_tenants()). That workaround existed only because the relay
 * ran on the tenant-scoped `db` under FORCE RLS; now that worker.ts uses the
 * BYPASSRLS scannerDb (shared/scanner-db.ts, migration
 * 0033_workflow_scanner_role.sql) with the shared startRelay()/
 * startOutboxPurge() helpers, none of that custom machinery should remain.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("workflow worker does not reintroduce the custom per-tenant relay", () => {
  const src = readFileSync(join(__dirname, "../src/worker.ts"), "utf8");

  it("does not define relayAllTenantsOnce", () => {
    expect(src).not.toMatch(/relayAllTenantsOnce/);
  });

  it("does not define purgeAllTenantsOnce", () => {
    expect(src).not.toMatch(/purgeAllTenantsOnce/);
  });

  it("does not call startRelay(db) directly (only scannerDb)", () => {
    expect(src).not.toMatch(/startRelay\(\s*db\s*[,)]/);
  });

  it("does not reference the retired tenant-enumeration SQL helpers", () => {
    expect(src).not.toMatch(/outbox_pending_tenants\(\)/);
    expect(src).not.toMatch(/outbox_purgeable_tenants\(/);
  });
});
