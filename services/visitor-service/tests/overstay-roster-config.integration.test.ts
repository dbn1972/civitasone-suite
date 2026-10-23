/**
 * The guard-console roster's overstay flag follows the tenant's configured policy
 * (visitor_policy check_in.overstay_grace_minutes / check_in.overstay_escalation_hours)
 * instead of a bare `validUntil < now`, matching the overstay worker. Defaults
 * (0 grace, 2h escalation) keep the prior behaviour for unconfigured tenants.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { listActiveVisitors } from "../src/modules/check-in/repo.js";
import { digitalPasses } from "../src/modules/digital-pass/schema.js";
import { visitRequests } from "../src/modules/visit-request/schema.js";
import { configEntries } from "../src/modules/config-registry/schema.js";
import { locations } from "../src/modules/location/schema.js";

const DEFAULTS = randomUUID(); // no config: 0 grace, 2h escalation
const CONFIGURED = randomUUID(); // 90 min grace, 1h escalation
const ACTOR = randomUUID();
const L = { [DEFAULTS]: randomUUID(), [CONFIGURED]: randomUUID() } as Record<string, string>;
const HOURS = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };
const MIN = 60_000;

async function seed(tenant: string, name: string, overdueMin: number) {
  const vr = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(visitRequests).values({ id: vr, tenantId: tenant, locationId: L[tenant]!, hostEmployeeId: randomUUID(), visitorName: name, visitorPhone: "+911234567890", createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(digitalPasses).values({
      id: randomUUID(), tenantId: tenant, visitRequestId: vr, locationId: L[tenant]!, passNumber: "P" + Math.floor(Math.random() * 1e9),
      passType: "single", status: "checked_in", qrJwt: "x", validFrom: new Date(Date.now() - 6 * 3_600_000),
      validUntil: new Date(Date.now() - overdueMin * MIN), createdBy: ACTOR, updatedBy: ACTOR,
    });
  });
}

beforeAll(async () => {
  for (const t of [DEFAULTS, CONFIGURED]) {
    await runWithTenant(t, () => db.transaction((tx) => tx.insert(locations).values({ id: L[t]!, tenantId: t, name: "L", businessHours: HOURS, createdBy: ACTOR, updatedBy: ACTOR })));
  }
  await runWithTenant(CONFIGURED, () => db.transaction(async (tx) => {
    await tx.insert(configEntries).values([
      { tenantId: CONFIGURED, namespace: "visitor_policy", configKey: "check_in.overstay_grace_minutes", value: 90 },
      { tenantId: CONFIGURED, namespace: "visitor_policy", configKey: "check_in.overstay_escalation_hours", value: 1 },
    ]);
  }));
  await runWithTenant(DEFAULTS, async () => { await seed(DEFAULTS, "d-30", 30); await seed(DEFAULTS, "d-150", 150); });
  await runWithTenant(CONFIGURED, async () => { await seed(CONFIGURED, "c-60", 60); await seed(CONFIGURED, "c-100", 100); await seed(CONFIGURED, "c-130", 130); });
});

afterAll(async () => {
  for (const t of [DEFAULTS, CONFIGURED]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(digitalPasses).where(eq(digitalPasses.tenantId, t));
      await tx.delete(visitRequests).where(eq(visitRequests.tenantId, t));
      await tx.delete(configEntries).where(eq(configEntries.tenantId, t));
      await tx.delete(locations).where(eq(locations.tenantId, t));
    }));
  }
});

const flags = (rows: Awaited<ReturnType<typeof listActiveVisitors>>) =>
  Object.fromEntries(rows.map((r) => [r.visitorName, [r.overstay, r.escalated]]));

describe("roster overstay/escalated follow the tenant policy", () => {
  it("unconfigured tenant: overstay as soon as valid_until passes, escalated after the 2h default", async () => {
    const rows = await runWithTenant(DEFAULTS, () => listActiveVisitors(DEFAULTS));
    expect(flags(rows)).toEqual({ "d-30": [true, false], "d-150": [true, true] });
  });
  it("configured tenant: 90 min grace delays overstay; 1h escalation window decides escalated", async () => {
    const rows = await runWithTenant(CONFIGURED, () => listActiveVisitors(CONFIGURED));
    expect(flags(rows)).toEqual({ "c-60": [false, false], "c-100": [true, true], "c-130": [true, true] });
  });
});
