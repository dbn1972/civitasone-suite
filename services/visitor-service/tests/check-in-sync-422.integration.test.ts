/**
 * POST /v1/visitor/check-ins refuses synchronously (422) instead of a 202 followed by a dead-letter,
 * judges a LIVE check-in at server time (a client timestamp cannot backdate it), allows a bounded
 * client timestamp only for an offline-recorded check-in, and honours the tenant window policy.
 * Real Postgres as the non-superuser visitor_svc role (RLS in force); the memory queue has no consumer
 * here, so a 202 means "would be accepted". All windows are relative to now (server time is the clock).
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
import { endOfDayInZone } from "../src/shared/tz.js";

const ACTOR = randomUUID();
const SECRET = process.env.JWT_SECRET as string;
const HOURS = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };
const NOW = Date.now();
const H = 3_600_000, M = 60_000;
const at = (ms: number) => new Date(NOW + ms);

interface PassSpec { from: Date; until: Date; status?: string; revoked?: boolean }
interface Tenant { id: string; loc: string; gate: string; passes: Record<string, string> }
const mk = (names: string[]): Tenant => ({ id: randomUUID(), loc: randomUUID(), gate: randomUUID(), passes: Object.fromEntries(names.map((n) => [n, randomUUID()])) });

const strict = mk(["ok", "future", "expired", "justExpired", "revoked", "checkedIn"]);
const startOfDay = mk(["lateToday"]);
const graceful = mk(["justExpired", "longExpired", "revokedInGrace"]);

function headers(tid: string, roles = ["security_admin"]): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles, sid: "sess-checkin-422" }, SECRET, 3600)}`,
    "content-type": "application/json",
  };
}

async function seed(t: Tenant, specs: Record<string, PassSpec>, policy?: Array<[string, unknown]>) {
  await runWithTenant(t.id, () => db.transaction(async (tx) => {
    await tx.insert(locations).values({ id: t.loc, tenantId: t.id, name: "Secretariat", businessHours: HOURS, createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(gates).values({ id: t.gate, tenantId: t.id, locationId: t.loc, name: "Gate 1", createdBy: ACTOR, updatedBy: ACTOR });
    for (const [name, s] of Object.entries(specs)) {
      const vr = randomUUID();
      await tx.insert(visitRequests).values({
        id: vr, tenantId: t.id, locationId: t.loc, hostEmployeeId: randomUUID(),
        visitorName: "Anita Sharma", visitorPhone: "+911234567890", createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(digitalPasses).values({
        id: t.passes[name]!, tenantId: t.id, visitRequestId: vr, locationId: t.loc, passNumber: "P" + Math.floor(Math.random() * 1e9),
        passType: "single", status: s.status ?? "active", revoked: s.revoked ?? false, qrJwt: "x",
        validFrom: s.from, validUntil: s.until, createdBy: ACTOR, updatedBy: ACTOR,
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
  await seed(strict, {
    ok: { from: at(-1 * H), until: at(1 * H) },
    future: { from: at(1 * H), until: at(3 * H) },
    expired: { from: at(-5 * H), until: at(-3 * H) },
    justExpired: { from: at(-3 * H), until: at(-10 * M) },
    revoked: { from: at(-1 * H), until: at(1 * H), status: "revoked", revoked: true },
    checkedIn: { from: at(-1 * H), until: at(1 * H), status: "checked_in" },
  });
  // Opens 60 s before the end of today (IST): strict refuses until then; start-of-day admits all day.
  const eod = endOfDayInZone(new Date(NOW));
  await seed(startOfDay, { lateToday: { from: new Date(eod.getTime() - 60_000), until: eod } }, [["check_in.allow_from_start_of_day", true]]);
  await seed(graceful, {
    justExpired: { from: at(-3 * H), until: at(-10 * M) },
    longExpired: { from: at(-3 * H), until: at(-60 * M) },
    revokedInGrace: { from: at(-3 * H), until: at(-10 * M), status: "revoked", revoked: true },
  }, [["check_in.expiry_grace_minutes", 30]]);
});
afterAll(async () => {
  for (const t of [strict, startOfDay, graceful]) await cleanup(t);
  await sqlClient.end();
});

async function checkIn(t: Tenant, pass: string, extra: Record<string, unknown> = {}) {
  const app = await buildApp();
  try {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/check-ins", headers: headers(t.id), payload: { passId: t.passes[pass] ?? pass, gateId: t.gate, ...extra } });
    return { status: res.statusCode, body: res.json() as { error?: { code?: string }; code?: string } };
  } finally {
    await app.close();
  }
}
const codeOf = (b: { error?: { code?: string }; code?: string }) => b.error?.code ?? b.code;
const iso = (ms: number) => at(ms).toISOString();

describe("synchronous refusals (default policy)", () => {
  it("accepts a pass inside its window (202)", async () => {
    expect((await checkIn(strict, "ok")).status).toBe(202);
  });
  it("422 PASS_NOT_YET_VALID before the scheduled time and PASS_EXPIRED after validUntil", async () => {
    const early = await checkIn(strict, "future");
    expect([early.status, codeOf(early.body)]).toEqual([422, "PASS_NOT_YET_VALID"]);
    const late = await checkIn(strict, "justExpired");
    expect([late.status, codeOf(late.body)]).toEqual([422, "PASS_EXPIRED"]);
  });
  it("422 UNKNOWN_PASS for a missing pass and for another tenant's pass", async () => {
    expect(codeOf((await checkIn(strict, randomUUID())).body)).toBe("UNKNOWN_PASS");
    expect(codeOf((await checkIn(strict, startOfDay.passes.lateToday!)).body)).toBe("UNKNOWN_PASS");
  });
  it("422 PASS_REVOKED and 422 for an already checked-in pass (no dead-letter)", async () => {
    expect(codeOf((await checkIn(strict, "revoked")).body)).toBe("PASS_REVOKED");
    expect((await checkIn(strict, "checkedIn")).status).toBe(422);
  });
});

describe("SECURITY: a client timestamp cannot backdate a live check-in", () => {
  it("an expired pass stays refused although the body claims a time inside its window", async () => {
    const r = await checkIn(strict, "expired", { timestamp: iso(-4 * H) });
    expect([r.status, codeOf(r.body)]).toEqual([422, "PASS_EXPIRED"]);
  });
  it("a not-yet-valid pass stays refused although the body claims a time inside its window", async () => {
    const r = await checkIn(strict, "future", { timestamp: iso(2 * H) });
    expect([r.status, codeOf(r.body)]).toEqual([422, "PASS_NOT_YET_VALID"]);
  });
  it("offlineRecorded=false with a backdated timestamp is judged at server time too", async () => {
    const r = await checkIn(strict, "expired", { offlineRecorded: false, timestamp: iso(-4 * H) });
    expect(r.status).toBe(422);
  });
});

describe("offline-recorded check-ins (bounded client timestamp)", () => {
  it("accepts a recent offline timestamp that falls inside the pass window", async () => {
    expect((await checkIn(strict, "justExpired", { offlineRecorded: true, timestamp: iso(-30 * M) })).status).toBe(202);
  });
  it("still refuses an offline timestamp outside the pass window", async () => {
    const r = await checkIn(strict, "justExpired", { offlineRecorded: true, timestamp: iso(-5 * M) });
    expect([r.status, codeOf(r.body)]).toEqual([422, "PASS_EXPIRED"]);
  });
  it("refuses an offline timestamp older than the tenant limit (default 12 h)", async () => {
    const r = await checkIn(strict, "expired", { offlineRecorded: true, timestamp: iso(-4 * H - 20 * H) });
    expect([r.status, codeOf(r.body)]).toEqual([422, "OFFLINE_TIMESTAMP_TOO_OLD"]);
  });
  it("refuses a future offline timestamp and an offline record with no timestamp", async () => {
    expect(codeOf((await checkIn(strict, "ok", { offlineRecorded: true, timestamp: iso(1 * H) })).body)).toBe("OFFLINE_TIMESTAMP_IN_FUTURE");
    expect(codeOf((await checkIn(strict, "ok", { offlineRecorded: true })).body)).toBe("OFFLINE_TIMESTAMP_REQUIRED");
  });
});

describe("tenant policy widens the window (security unchanged)", () => {
  it("allow_from_start_of_day admits a pass that only opens later today", async () => {
    expect((await checkIn(startOfDay, "lateToday")).status).toBe(202);
  });
  it("expiry_grace_minutes admits within grace and refuses beyond it", async () => {
    expect((await checkIn(graceful, "justExpired")).status).toBe(202);
    const late = await checkIn(graceful, "longExpired");
    expect([late.status, codeOf(late.body)]).toEqual([422, "PASS_EXPIRED"]);
  });
  it("a REVOKED pass inside the grace window is still refused", async () => {
    const r = await checkIn(graceful, "revokedInGrace");
    expect([r.status, codeOf(r.body)]).toEqual([422, "PASS_REVOKED"]);
  });
});

describe("policy writes", () => {
  const write = async (roles: string[], configKey: string, value: unknown) => {
    const app = await buildApp();
    try {
      return await app.inject({ method: "POST", url: "/v1/visitor/config", headers: headers(strict.id, roles), payload: { namespace: "visitor_policy", configKey, value } });
    } finally {
      await app.close();
    }
  };
  it("expiry_grace_minutes=1441 is refused at the API (400), 1440 is accepted", async () => {
    expect((await write(["tenant_admin"], "check_in.expiry_grace_minutes", 1441)).statusCode).toBe(400);
    expect((await write(["tenant_admin"], "check_in.expiry_grace_minutes", 1440)).statusCode).toBe(202);
  });
  it("a non-admin (security_admin, gate_terminal, employee) cannot write policy (403)", async () => {
    for (const role of ["security_admin", "gate_terminal", "employee"]) {
      expect((await write([role], "check_in.expiry_grace_minutes", 30)).statusCode, role).toBe(403);
    }
  });
  it("offline_max_age_hours and tenant.time_zone are bounds/IANA checked", async () => {
    expect((await write(["tenant_admin"], "check_in.offline_max_age_hours", 0)).statusCode).toBe(400);
    expect((await write(["tenant_admin"], "tenant.time_zone", "Mars/Olympus")).statusCode).toBe(400);
    expect((await write(["tenant_admin"], "tenant.time_zone", "Asia/Kolkata")).statusCode).toBe(202);
  });
});
