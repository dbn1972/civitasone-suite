/**
 * SVC-039 — budget monitoring & forecasting HTTP integration against the dev DB.
 *
 * Seeds allocations with distinct spend profiles and proves the dashboard
 * computes availability/burn/forecast + exception flags, the exception-only
 * dashboard, the portfolio summary, RLS isolation and role gating.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeBudgetAllocation } from "../src/modules/budget/allocation-schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT_A = "aaaaaaaa-1111-4000-8000-0000000fa039";
const TENANT_B = "aaaaaaaa-1111-4000-8000-0000000fb039";
const ACTOR = "00000000-aaaa-4000-8000-00000000a039";
const FY = "2025-26";
const AS_OF = "2025-09-30"; // ~half the FY

const OVER = randomUUID(), OVERSPEND = randomUUID(), UNDER = randomUUID(), OK = randomUUID();

function token(tenant: string, roles: string[], sub = ACTOR) {
  return signToken({ sub, tid: tenant, roles, sid: "sess-mon" }, SECRET);
}
const reader = (t = TENANT_A) => ({ authorization: `Bearer ${token(t, ["finance_officer"])}` });

async function seed() {
  for (const t of [TENANT_A, TENANT_B]) {
    await scoped(t, (tx) => tx.delete(financeBudgetAllocation).where(eq(financeBudgetAllocation.fy, FY)));
  }
  const mk = (id: string, head: string, alloc: bigint, com: bigint, act: bigint) => ({
    id, tenantId: TENANT_A, headId: head, fy: FY, allocatedMinor: alloc, committedMinor: com, actualMinor: act,
    enforce: true, currency: "INR", createdBy: ACTOR, updatedBy: ACTOR,
  });
  await scoped(TENANT_A, (tx) => tx.insert(financeBudgetAllocation).values([
    mk(OVER, randomUUID(), 1000n, 900n, 200n),     // over_committed
    mk(OVERSPEND, randomUUID(), 1000n, 0n, 600n),  // projected_overspend at half-year
    mk(UNDER, randomUUID(), 1000n, 0n, 100n),      // under_utilised
    mk(OK, randomUUID(), 1000n, 0n, 450n),         // on_track
  ]));
}

beforeAll(seed);
afterAll(async () => {
  for (const t of [TENANT_A, TENANT_B]) {
    await scoped(t, (tx) => tx.delete(financeBudgetAllocation).where(eq(financeBudgetAllocation.fy, FY)));
  }
  await sqlClient.end();
});

describe("SVC-039 monitoring — dashboard", () => {
  it("computes per-head availability/burn/forecast + exceptions and portfolio totals", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: `/v1/finance/budget-monitoring?fy=${FY}&asOf=${AS_OF}`, headers: reader() });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.totals.count).toBe(4);
      expect(body.totals.allocatedMinor).toBe("4000");
      expect(body.totals.actualMinor).toBe("1350");
      // exception buckets each get one head
      expect(body.totals.exceptions.over_committed).toBe(1);
      expect(body.totals.exceptions.projected_overspend).toBe(1);
      expect(body.totals.exceptions.under_utilised).toBe(1);
      expect(body.totals.exceptions.on_track).toBe(1);

      const over = (body.lines as Array<Record<string, string>>).find((l) => l.id === OVER)!;
      expect(over.availableMinor).toBe("-100");
      expect(over.exception).toBe("over_committed");
      const overspend = (body.lines as Array<Record<string, string>>).find((l) => l.id === OVERSPEND)!;
      expect(overspend.exception).toBe("projected_overspend");
      expect(BigInt(overspend.forecastYearEndMinor)).toBeGreaterThan(1000n);
    } finally { await app.close(); }
  });

  it("exception dashboard returns only heads needing attention", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: `/v1/finance/budget-monitoring/exceptions?fy=${FY}&asOf=${AS_OF}`, headers: reader() });
      expect(res.statusCode).toBe(200);
      expect(res.json().count).toBe(3); // all but on_track
      expect((res.json().lines as Array<{ exception: string }>).every((l) => l.exception !== "on_track")).toBe(true);
    } finally { await app.close(); }
  });

  it("summary returns portfolio totals only", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: `/v1/finance/budget-monitoring/summary?fy=${FY}&asOf=${AS_OF}`, headers: reader() });
      expect(res.statusCode).toBe(200);
      expect(res.json().totals.count).toBe(4);
      expect(res.json().totals.availableMinor).toBeDefined();
    } finally { await app.close(); }
  });

  it("RLS: tenant B sees no allocations", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: `/v1/finance/budget-monitoring?fy=${FY}`, headers: reader(TENANT_B) });
      expect(res.statusCode).toBe(200);
      expect(res.json().totals.count).toBe(0);
    } finally { await app.close(); }
  });

  it("rejects a malformed FY with 400", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: `/v1/finance/budget-monitoring?fy=2025`, headers: reader() });
      expect(res.statusCode).toBe(400);
    } finally { await app.close(); }
  });

  it("403 for a non-finance role", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: `/v1/finance/budget-monitoring?fy=${FY}`, headers: { authorization: `Bearer ${token(TENANT_A, ["citizen"])}` } });
      expect(res.statusCode).toBe(403);
    } finally { await app.close(); }
  });
});
