/**
 * CLOS3-S4-14: the pending-register overdue sweep decides "due date has passed" on the IST
 * calendar date, not the UTC date. Between 00:00 and 05:30 IST the UTC date is still the previous
 * day, so items due the previous IST day were not flipped to overdue.
 *
 * Real Postgres as the non-superuser audit_svc role (FORCE RLS enforced). Skips when Postgres is
 * unreachable.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { eq } from "drizzle-orm";

const DSN = process.env["DATABASE_URL"] ?? "";
async function probe(): Promise<boolean> {
  const client = postgres(DSN, { max: 1, connect_timeout: 2, idle_timeout: 1, onnotice: () => {} });
  try { await client`SELECT 1 FROM compliance.audit_pending_register LIMIT 1`; return true; } catch { return false; }
  finally { await client.end({ timeout: 1 }).catch(() => undefined); }
}
const reachable = DSN !== "" && (await probe());
if (!reachable) throw new Error(`closure3-s4-14: Postgres not reachable (DATABASE_URL=${DSN === "" ? "unset" : DSN.replace(/:[^:@/]+@/, ":***@")}); CI bootstraps it, locally run scripts/ci/bootstrap-postgres.sh`);

const { db, sqlClient, scopedPlatformRead } = await import("../src/shared/db.js");
const { runWithTenant } = await import("@civitasone/db");
const repo = await import("../src/modules/compliance/repo.js");
const { auditPendingRegister } = await import("../src/modules/compliance/schema.js");

const ACTOR = randomUUID();
const tenants: string[] = [];

async function seedItem(dueDate: string): Promise<{ tenantId: string; id: string }> {
  const tenantId = randomUUID(); tenants.push(tenantId);
  const id = randomUUID();
  await Promise.resolve(runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.insert(auditPendingRegister).values({ id, tenantId, paraId: randomUUID(), deptRef: "D", dueDate, createdBy: ACTOR, updatedBy: ACTOR });
  })));
  return { tenantId, id };
}
const sweep = (tenantId: string, now: Date) =>
  Promise.resolve(runWithTenant(tenantId, () => db.transaction((tx) => repo.sweepOverdueBatch(tx, now, 100))));
const candidates = (now: Date) => scopedPlatformRead((tx) => repo.findOverdueTenantIds(tx, now));

describe("CLOS3-S4-14 overdue sweep uses the IST date (real Postgres)", () => {
  afterAll(async () => {
    for (const t of tenants) {
      await Promise.resolve(runWithTenant(t, () => db.transaction(async (tx) => { await tx.delete(auditPendingRegister).where(eq(auditPendingRegister.tenantId, t)); }))).catch(() => undefined);
    }
    await sqlClient.end({ timeout: 5 }).catch(() => undefined);
  });

  it("01:30 IST on 27 Oct (20:00Z on 26 Oct): an item due 26 Oct is overdue", async () => {
    const { tenantId, id } = await seedItem("2026-10-26");
    const now = new Date("2026-10-26T20:00:00Z");
    expect(await candidates(now)).toContain(tenantId);
    expect((await sweep(tenantId, now)).map((r) => r.id)).toEqual([id]);
  });

  it("23:59:59 IST on 26 Oct (18:29:59Z): an item due 26 Oct is NOT yet overdue", async () => {
    const { tenantId } = await seedItem("2026-10-26");
    const now = new Date("2026-10-26T18:29:59Z");
    expect(await candidates(now)).not.toContain(tenantId);
    expect(await sweep(tenantId, now)).toEqual([]);
  });

  it("00:00:00 IST on 27 Oct (18:30:00Z on 26 Oct): an item due 26 Oct becomes overdue", async () => {
    const { tenantId, id } = await seedItem("2026-10-26");
    const now = new Date("2026-10-26T18:30:00Z");
    expect(await candidates(now)).toContain(tenantId);
    expect((await sweep(tenantId, now)).map((r) => r.id)).toEqual([id]);
  });
});
