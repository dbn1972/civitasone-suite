/**
 * POST /v1/visitor/check-ins refuses synchronously (422) instead of a 202 followed by a dead-letter,
 * and the validity window honours the tenant policy. Real Postgres as the non-superuser visitor_svc
 * role (RLS in force); the memory queue has no consumer here, so a 202 means "would be accepted".
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { db, sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";
import { digitalPasses } from "../src/modules/digital-pass/schema.js";
import { visitRequests } from "../src/modules/visit-request/schema.js";
import { locations, gates } from "../src/modules/location/schema.js";
import { configEntries } from "../src/modules/config-registry/schema.js";

const ACTOR = randomUUID();
const SECRET = process.env.JWT_SECRET as string;
const HOURS = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };
// Scheduled 10:00 IST on 10 Jun 2030, valid to end of that IST day.
const FROM = new Date("2030-06-10T04:30:00.000Z");
const UNTIL = new Date("2030-06-10T18:29:59.999Z");

interface Tenant { id: string; loc: string; gate: string; pass: string; revokedPass: string; checkedInPass: string }
const mk = (): Tenant => ({ id: randomUUID(), loc: randomUUID(), gate: randomUUID(), pass: randomUUID(), revokedPass: randomUUID(), checkedInPass: randomUUID() });
const strict = mk(), startOfDay = mk(), graceful = mk();

function headers(tid: string): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles: ["security_admin"], sid: "sess-checkin-422" }, SECRET, 3600)}`,
    "content-type": "application/json",
  };
}

async function seed(t: Tenant, policy?: Array<[string, unknown]>) {
  await runWithTenant(t.id, () => db.transaction(async (tx) => {
    await tx.insert(locations).values({ id: t.loc, tenantId: t.id, name: "Secretariat", businessHours: HOURS, createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(gates).values({ id: t.gate, tenantId: t.id, locationId: t.loc, name: "Gate 1", createdBy: ACTOR, updatedBy: ACTOR });
    for (const [pid, status, revoked] of [[t.pass, "active", false], [t.revokedPass, "revoked", true], [t.checkedInPass, "checked_in", false]] as const) {
      const vr = randomUUID();
      await tx.insert(visitRequests).values({
        id: vr, tenantId: t.id, locationId: t.loc, hostEmployeeId: randomUUID(),
        visitorName: "Anita Sharma", visitorPhone: "+911234567890", createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(digitalPasses).values({
        id: pid, tenantId: t.id, visitRequestId: vr, locationId: t.loc, passNumber: "P" + Math.floor(Math.random() * 1e9),
        passType: "single", status, revoked, qrJwt: "x", validFrom: FROM, validUntil: UNTIL, createdBy: ACTOR, updatedBy: ACTOR,
      });
    }
    for (const [key, value] of policy ?? []) {
      await tx.insert(configEntries).values({ tenantId: t.id, namespace: "visitor_policy", configKey: key, value, createdBy: ACTOR, updatedBy: ACTOR });
    }
  }));
}

async function cleanup(t: Tenant) {
  await runWithTenant(t.id, () => db.transaction(async (tx) => {
    await tx.delete(configEntries).where(eq(configEntries.tenantId, t.id));
    await tx.delete(digitalPasses).where(eq(digitalPasses.tenantId, t.id));
    await tx.delete(visitRequests).where(eq(visitRequests.tenantId, t.id));
    await tx.delete(gates).where(eq(gates.tenantId, t.id));
    await tx.delete(locations).where(eq(locations.tenantId, t.id));
  }));
}

beforeAll(async () => {
  await seed(strict);
  await seed(startOfDay, [["check_in.allow_from_start_of_day", true]]);
  await seed(graceful, [["check_in.expiry_grace_minutes", 30]]);
});
afterAll(async () => {
  for (const t of [strict, startOfDay, graceful]) await cleanup(t);
  await sqlClient.end();
});

async function checkIn(t: Tenant, passId: string, timestamp: string) {
  const app = await buildApp();
  try {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/check-ins", headers: headers(t.id), payload: { passId, gateId: t.gate, timestamp } });
    return { status: res.statusCode, body: res.json() as { error?: { code?: string }; code?: string; data?: unknown } };
  } finally {
    await app.close();
  }
}
const codeOf = (b: { error?: { code?: string }; code?: string }) => b.error?.code ?? b.code;

describe("POST /v1/visitor/check-ins - synchronous refusals", () => {
  it("accepts a pass inside its window (202)", async () => {
    expect((await checkIn(strict, strict.pass, "2030-06-10T05:00:00.000Z")).status).toBe(202);
  });

  it("422 PASS_NOT_YET_VALID before the scheduled time (default policy is strict)", async () => {
    const r = await checkIn(strict, strict.pass, "2030-06-10T04:00:00.000Z");
    expect(r.status).toBe(422);
    expect(codeOf(r.body)).toBe("PASS_NOT_YET_VALID");
  });

  it("422 PASS_EXPIRED after the end of validity (default policy has no grace)", async () => {
    const r = await checkIn(strict, strict.pass, "2030-06-10T18:30:00.000Z");
    expect(r.status).toBe(422);
    expect(codeOf(r.body)).toBe("PASS_EXPIRED");
  });

  it("422 UNKNOWN_PASS for a pass that does not exist (or belongs to another tenant)", async () => {
    expect(codeOf((await checkIn(strict, randomUUID(), "2030-06-10T05:00:00.000Z")).body)).toBe("UNKNOWN_PASS");
    const cross = await checkIn(strict, startOfDay.pass, "2030-06-10T05:00:00.000Z");
    expect(cross.status).toBe(422);
    expect(codeOf(cross.body)).toBe("UNKNOWN_PASS");
  });

  it("422 PASS_REVOKED for a revoked pass", async () => {
    const r = await checkIn(strict, strict.revokedPass, "2030-06-10T05:00:00.000Z");
    expect(r.status).toBe(422);
    expect(codeOf(r.body)).toBe("PASS_REVOKED");
  });

  it("422 for a pass that is already checked in (invalid transition), not a dead-letter", async () => {
    const r = await checkIn(strict, strict.checkedInPass, "2030-06-10T05:00:00.000Z");
    expect(r.status).toBe(422);
  });
});

describe("tenant policy widens the window", () => {
  it("allow_from_start_of_day admits an early arrival on the scheduled day, but not the day before", async () => {
    expect((await checkIn(startOfDay, startOfDay.pass, "2030-06-10T03:00:00.000Z")).status).toBe(202); // 08:30 IST
    const prev = await checkIn(startOfDay, startOfDay.pass, "2030-06-09T18:00:00.000Z");
    expect(prev.status).toBe(422);
    expect(codeOf(prev.body)).toBe("PASS_NOT_YET_VALID");
  });

  it("expiry_grace_minutes admits a late arrival within grace, refuses beyond it", async () => {
    expect((await checkIn(graceful, graceful.pass, "2030-06-10T18:50:00.000Z")).status).toBe(202);
    const late = await checkIn(graceful, graceful.pass, "2030-06-10T19:10:00.000Z");
    expect(late.status).toBe(422);
    expect(codeOf(late.body)).toBe("PASS_EXPIRED");
  });
});
