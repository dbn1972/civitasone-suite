/**
 * UAT B4 — GAP-LOYALTY-ACCRUALS-01 (tenant-wide points ledger,
 * GET /v1/loyalty/accruals). Real Postgres + real RLS (non-superuser role).
 * Unique per-file ids so parallel test files cannot collide.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { programs } from "../src/modules/programs/schema.js";
import { enrolments } from "../src/modules/enrolments/schema.js";
import { accruals } from "../src/modules/accruals/schema.js";

const SECRET = process.env.JWT_SECRET ?? "";
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const PROGRAM = randomUUID();
const ENROLMENT = randomUUID();

const tx = <T>(fn: (t: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>, tenant = TENANT) =>
  runWithTenant(tenant, () => db.transaction(fn));

// The gateway stamps x-tenant-id from the verified JWT; the tenant-tx hook reads it.
const headers = (roles: string[], tid = TENANT) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles, sid: randomUUID() }, SECRET)}`,
  "x-tenant-id": tid,
});

async function clean() {
  for (const t of [TENANT, OTHER_TENANT]) {
    await tx(async (x) => {
      await x.delete(accruals).where(eq(accruals.tenantId, t));
      await x.delete(enrolments).where(eq(enrolments.tenantId, t));
      await x.delete(programs).where(eq(programs.tenantId, t));
    }, t);
  }
}

const seedAccrual = (enrolmentId: string, points: bigint, when: string) =>
  tx((x) =>
    x.insert(accruals).values({
      tenantId: TENANT, enrolmentId, points, source: "purchase", txType: "purchase",
      accrualDate: new Date(when), createdBy: ACTOR,
    }),
  );

let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => { app = await buildApp(); await app.ready(); });
beforeEach(async () => {
  await clean();
  await tx(async (x) => {
    await x.insert(programs).values({
      id: PROGRAM, tenantId: TENANT, name: "Ledger fixture", status: "active",
      earnRatio: 100n, createdBy: ACTOR, updatedBy: ACTOR,
    });
    await x.insert(enrolments).values({
      id: ENROLMENT, tenantId: TENANT, programId: PROGRAM, profileId: randomUUID(),
      status: "active", tier: "base", pointsBalance: 0n, lifetimePoints: 0n,
      createdBy: ACTOR, updatedBy: ACTOR, version: 1,
    });
  });
});
afterAll(async () => { await clean(); await app.close(); await sqlClient.end(); });

describe("GAP-LOYALTY-ACCRUALS-01 tenant-wide points ledger", () => {
  it("lists points transactions for the tenant, newest first, with a total", async () => {
    await seedAccrual(ENROLMENT, 120n, "2026-10-01T05:00:00Z");
    await seedAccrual(ENROLMENT, 80n, "2026-10-02T05:00:00Z");
    const res = await app.inject({ method: "GET", url: "/v1/loyalty/accruals?limit=1", headers: headers(["loyalty_user"]) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meta.total).toBe(2);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].points).toBe("80");
    expect(body.data[0].enrolmentId).toBe(ENROLMENT);
  });

  it("filters by enrolment", async () => {
    await seedAccrual(ENROLMENT, 10n, "2026-10-01T05:00:00Z");
    const none = await app.inject({
      method: "GET", url: `/v1/loyalty/accruals?enrolmentId=${randomUUID()}`, headers: headers(["loyalty_user"]),
    });
    expect(none.json().data).toHaveLength(0);
    const some = await app.inject({
      method: "GET", url: `/v1/loyalty/accruals?enrolmentId=${ENROLMENT}`, headers: headers(["loyalty_user"]),
    });
    expect(some.json().data).toHaveLength(1);
  });

  it("is tenant-isolated and role-gated", async () => {
    await seedAccrual(ENROLMENT, 50n, "2026-10-03T05:00:00Z");
    const other = await app.inject({ method: "GET", url: "/v1/loyalty/accruals", headers: headers(["loyalty_user"], OTHER_TENANT) });
    expect(other.statusCode).toBe(200);
    expect(other.json().data).toHaveLength(0);
    const denied = await app.inject({ method: "GET", url: "/v1/loyalty/accruals", headers: headers(["employee"]) });
    expect(denied.statusCode).toBe(403);
  });
});
