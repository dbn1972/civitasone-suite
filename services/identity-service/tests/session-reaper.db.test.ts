import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";

// DB-gated integration test for sessions/repo.ts#reapExpiredSessions.
//
// Before this fix, reapExpiredSessions() had NO test coverage at all. It ran
// a bare db.update() (not even in a transaction) from worker.ts's setInterval
// with no app.tenant_id GUC set. sessions.sessions is FORCE ROW LEVEL
// SECURITY and identity_svc is NOBYPASSRLS (#146), so
// `tenant_id = current_tenant_id()` compared against NULL matched zero rows —
// the expired-session reaper has silently reaped nothing, for every tenant,
// since RLS was tightened. This test seeds expired-active sessions for TWO
// tenants and calls the reaper with NO ambient tenant context (mirroring
// worker.ts exactly), proving the identity_scanner BYPASSRLS-role fix
// actually discovers and reaps rows it could not see before.
const RUN_DB = process.env.DATABASE_URL ?? process.env.DB_URL;

const TENANT_A = "00000000-0000-0000-0000-000000000001";
const TENANT_B = "00000000-0000-0000-0000-0000000000b2";

describe.skipIf(!RUN_DB)("sessions — expired-session reaper (RLS scanner-role regression guard)", () => {
  let repo: typeof import("../src/modules/sessions/repo.js");
  let db: any;
  let sessions: any;

  beforeAll(async () => {
    repo = await import("../src/modules/sessions/repo.js");
    ({ db } = await import("../src/shared/db.js"));
    ({ sessions } = await import("../src/modules/sessions/schema.js"));
  });

  async function seedExpiredActiveSession(tenantId: string): Promise<string> {
    const id = randomUUID();
    await runWithTenant(tenantId, () => db.transaction(async (tx: any) => {
      await tx.insert(sessions).values({
        id,
        tenantId,
        userId: randomUUID(),
        ip: "10.0.0.9",
        status: "active",
        userEmail: "reaper-coverage@x.gov.in",
        startedAt: new Date(Date.now() - 2 * 60 * 60_000),
        // toView() presents an active-but-past-expiry row as "expired" on
        // read regardless of the reaper, so assert the RAW db.status column
        // directly below rather than a read through repo.findById().
        expiresAt: new Date(Date.now() - 60_000),
        lastActiveAt: new Date(Date.now() - 2 * 60 * 60_000),
        createdBy: randomUUID(),
        updatedBy: randomUUID(),
      });
    }));
    return id;
  }

  // A bare db.select() (outside db.transaction()) never gets app.tenant_id
  // set — wrapWithTenantGuc only intercepts transaction() — so it would
  // silently see zero rows under RLS regardless of runWithTenant(). Use
  // db.transaction() here (mirrors shared/db.ts#scopedRead) so the read is
  // actually tenant-scoped by RLS, not just by an app-layer WHERE.
  async function rawStatus(tenantId: string, id: string): Promise<string | undefined> {
    const rows = await runWithTenant(tenantId, () => db.transaction((tx: any) =>
      tx.select().from(sessions).where(eq(sessions.id, id))));
    return rows[0]?.status;
  }

  it("reaps a single tenant's expired-active session with no ambient tenant context", async () => {
    const id = await seedExpiredActiveSession(TENANT_A);
    expect(await rawStatus(TENANT_A, id)).toBe("active");

    // Bare call — exactly how worker.ts's setInterval invokes this. No
    // runWithTenant() wrapper here; that is the whole point of the test.
    const reaped = await repo.reapExpiredSessions();
    expect(reaped).toBeGreaterThanOrEqual(1);

    expect(await rawStatus(TENANT_A, id)).toBe("expired");
  });

  it("is cross-tenant: one un-scoped call reaps due sessions for BOTH tenants", async () => {
    const idA = await seedExpiredActiveSession(TENANT_A);
    const idB = await seedExpiredActiveSession(TENANT_B);
    expect(await rawStatus(TENANT_A, idA)).toBe("active");
    expect(await rawStatus(TENANT_B, idB)).toBe("active");

    await repo.reapExpiredSessions();

    expect(await rawStatus(TENANT_A, idA)).toBe("expired");
    expect(await rawStatus(TENANT_B, idB)).toBe("expired");
  });

  it("does not touch a still-valid active session", async () => {
    const id = randomUUID();
    await runWithTenant(TENANT_A, () => db.transaction(async (tx: any) => {
      await tx.insert(sessions).values({
        id, tenantId: TENANT_A, userId: randomUUID(), ip: "10.0.0.9",
        status: "active", userEmail: "reaper-coverage@x.gov.in",
        startedAt: new Date(), expiresAt: new Date(Date.now() + 60 * 60_000),
        lastActiveAt: new Date(), createdBy: randomUUID(), updatedBy: randomUUID(),
      });
    }));

    await repo.reapExpiredSessions();

    expect(await rawStatus(TENANT_A, id)).toBe("active");
  });
});
