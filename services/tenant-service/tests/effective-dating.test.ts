/**
 * effective-dating helpers — unit + real-DB integration (CAP-018).
 *
 * Proves the generic versioning helpers the masters rely on: isEffective
 * (point-in-time membership), activeSql (SQL predicate for effective rows) and
 * openSql (currently-open versions), exercised against real tenant.org_units
 * rows under FORCED RLS.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { and, eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { orgUnits } from "../src/modules/org-hierarchy/schema.js";
import { isEffective, activeSql, openSql, supersedeAt } from "../src/shared/effective-dating.js";

const T1 = "aaaaaaaa-1111-4000-8000-000000000181";
const ACTOR = "cccccccc-3333-4000-8000-000000000181";
const DAY = 86_400_000;

async function wipe(): Promise<void> {
  await runWithTenant(T1, () => db.transaction(async (tx) => { await tx.delete(orgUnits).where(eq(orgUnits.tenantId, T1)); }));
}

describe("effective-dating (CAP-018)", () => {
  beforeAll(wipe);
  afterAll(async () => { await wipe(); await sqlClient.end(); });

  it("isEffective: open row is effective now, closed/future rows are not", () => {
    const now = new Date();
    const past = new Date(now.getTime() - DAY);
    const future = new Date(now.getTime() + DAY);
    expect(isEffective({ effectiveFrom: past, effectiveTo: null }, now)).toBe(true);
    expect(isEffective({ effectiveFrom: past, effectiveTo: future }, now)).toBe(true);
    expect(isEffective({ effectiveFrom: past, effectiveTo: past }, now)).toBe(false);   // closed
    expect(isEffective({ effectiveFrom: future, effectiveTo: null }, now)).toBe(false);  // not yet
  });

  it("supersedeAt returns the new version's start", () => {
    const d = new Date();
    expect(supersedeAt(d).getTime()).toBe(d.getTime());
  });

  it("activeSql + openSql filter real rows correctly under RLS", async () => {
    const now = Date.now();
    const A = randomUUID(); const B = randomUUID(); const C = randomUUID();
    await runWithTenant(T1, () => db.transaction(async (tx) => {
      await tx.insert(orgUnits).values([
        { id: A, tenantId: T1, name: "Active", type: "unit", level: 1, createdBy: ACTOR, effectiveFrom: new Date(now - 2 * DAY), effectiveTo: null },
        { id: B, tenantId: T1, name: "Closed", type: "unit", level: 1, createdBy: ACTOR, effectiveFrom: new Date(now - 2 * DAY), effectiveTo: new Date(now - DAY) },
        { id: C, tenantId: T1, name: "Future", type: "unit", level: 1, createdBy: ACTOR, effectiveFrom: new Date(now + DAY), effectiveTo: null },
      ]);
    }));

    // Effective now → only A.
    const active = await runWithTenant(T1, () => db.transaction((tx) =>
      tx.select().from(orgUnits).where(and(eq(orgUnits.tenantId, T1), activeSql(orgUnits.effectiveFrom, orgUnits.effectiveTo)))));
    expect(active.map((r) => r.id).sort()).toEqual([A].sort());

    // Open (no close date) → A and C (B is closed).
    const open = await runWithTenant(T1, () => db.transaction((tx) =>
      tx.select().from(orgUnits).where(and(eq(orgUnits.tenantId, T1), openSql(orgUnits.effectiveTo)))));
    expect(open.map((r) => r.id).sort()).toEqual([A, C].sort());

    // Point-in-time two days ago → A and B were both effective, C not yet.
    const asOf = new Date(now - 2 * DAY + 1000);
    const past = await runWithTenant(T1, () => db.transaction((tx) =>
      tx.select().from(orgUnits).where(and(eq(orgUnits.tenantId, T1), activeSql(orgUnits.effectiveFrom, orgUnits.effectiveTo, asOf)))));
    expect(past.map((r) => r.id).sort()).toEqual([A, B].sort());
  });
});
