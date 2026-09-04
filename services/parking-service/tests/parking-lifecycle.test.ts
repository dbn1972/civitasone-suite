/**
 * DB + queue-backed suite for parking-service (baseline: zero test files;
 * PR #1000 added vitest.config.ts but nothing exercised it until now).
 *
 * Drives the real Fastify app (`app.inject`) through the actual
 * command/consumer/outbox pipeline (MemoryQueue, same wiring as production's
 * worker.ts), then asserts against the real Postgres rows — migrations
 * applied via the same scripts/ci/bootstrap-postgres.sh CI uses, against a
 * throwaway isolated container.
 *
 * All DB-touching tests live in this ONE file (mirroring
 * services/trade-service/tests/trade-lifecycle.test.ts): vitest runs test
 * files in separate workers by default, and every file here shares one real
 * Postgres database, so a second file's beforeAll TRUNCATE would race this
 * one's. Pure, DB-free unit tests for domain.ts live separately in
 * tests/domain.test.ts, safe to run in parallel.
 *
 * Covers, in order:
 *   1. Auth wall.
 *   2. Facilities: create/update, INCLUDING the money-codec regression fix
 *      (tariff/pass fields — see facilities/routes.ts and money.ts) proving
 *      the precision-loss bug is closed at the route boundary and that large
 *      values still persist byte-for-byte exact.
 *   3. Bookings: facility-existence check, full booked -> active -> completed
 *      lifecycle with a real tariff-derived fee, and the ownership check
 *      (a citizen may only see/cancel their OWN booking; staff see all).
 *   4. Enforcement: issue -> pay / issue -> contest, INCLUDING a positive
 *      test that a DIFFERENT user in the same tenant (not the issuing
 *      officer) can still pay/contest — proving the deliberate tenant-scoped
 *      (not ownership-scoped) design documented in enforcement/routes.ts is
 *      correct and actually in effect, not an accidental gap.
 *   5. RLS cross-tenant isolation, proven at both the repo layer (wrong
 *      ambient tenant context blocks a row even when the WHERE clause names
 *      the right tenant) and the HTTP layer (cross-tenant GET -> 404).
 *   6. Outbox idempotency: replaying the same command messageId does not
 *      double-insert.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { zMoneyMinorStringNonNeg } from "@civitasone/schemas";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { tenantScoped } from "../src/shared/tenant-queue.js";
import { registerFacilityConsumers } from "../src/modules/facilities/consumer.js";
import { registerBookingConsumers } from "../src/modules/bookings/consumer.js";
import { registerEnforcementConsumers } from "../src/modules/enforcement/consumer.js";
import * as facilitiesRepo from "../src/modules/facilities/repo.js";
import * as bookingsRepo from "../src/modules/bookings/repo.js";
import * as enforcementRepo from "../src/modules/enforcement/repo.js";

// Production wiring (src/worker.ts) registers these against the same queue
// singleton `app.ts` publishes to; tests need the same registration so an
// HTTP-triggered 202 actually gets applied once the queue is drained.
registerFacilityConsumers(tenantScoped(queue));
registerBookingConsumers(tenantScoped(queue));
registerEnforcementConsumers(tenantScoped(queue));

const T1 = "aaaaaaaa-0000-4000-8000-000000000001";
// A second tenant, used ONLY by the RLS isolation tests below. Same reasoning
// as trade-service's T2: AsyncLocalStorage tenant context set via
// tenantStorage.enterWith() (createTenantTxHook) does not pop back like a
// scoped try/finally, so using a tenant id no bearer()/app.inject() call
// anywhere else in this file ever uses keeps those assertions correct
// regardless of ambient leakage from earlier tests.
const T2 = "bbbbbbbb-0000-4000-8000-000000000002";
const ACTOR = "aaaaaaaa-0000-4000-8000-0000000000ac";
const OTHER_ACTOR = "aaaaaaaa-0000-4000-8000-0000000000a0";
const OFFICER = "aaaaaaaa-0000-4000-8000-00000000000f";
const SECRET = process.env.JWT_SECRET as string;

function bearer(roles: string[] = ["parking_admin"], actor = ACTOR, tenant = T1): { authorization: string; "x-tenant-id": string } {
  const token = signToken({ sub: actor, roles, tid: tenant } as never, SECRET);
  return { authorization: `Bearer ${token}`, "x-tenant-id": tenant };
}

async function drain(): Promise<void> {
  await (queue as unknown as { drain: () => Promise<void> }).drain();
}

async function resetDb(): Promise<void> {
  await sqlClient`
    TRUNCATE parking.parking_facilities, parking.parking_bookings, parking.parking_passes,
             parking.parking_violations, _outbox.messages, _inbox.processed
    CASCADE
  `;
}

beforeAll(resetDb);
afterAll(async () => {
  await resetDb();
  await sqlClient.end();
});

const baseFacilityBody = {
  facilityName: "MG Road Multi-Level",
  facilityType: "multi_level" as const,
  address: { line1: "MG Road", city: "Pune", pin: "411001" },
  totalSpaces: 200,
};

describe("parking-service — auth wall", () => {
  it("POST /v1/parking/facilities with no token -> 401", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/parking/facilities", payload: baseFacilityBody });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe("zMoneyMinorStringNonNeg — the codec facilities/routes.ts now uses for tariff/pass fields", () => {
  it("accepts a plain JSON number within the safe-integer range and outputs a canonical string", () => {
    const r = zMoneyMinorStringNonNeg.safeParse(5000);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe("5000");
  });

  it("accepts an arbitrary-precision base-10 STRING far beyond 2^53 without loss", () => {
    const r = zMoneyMinorStringNonNeg.safeParse("9223372036854775807"); // 2^63 - 1
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe("9223372036854775807");
  });

  it("REGRESSION: rejects an unsafe-integer JSON number (>2^53) instead of silently truncating it", () => {
    // Exactly the value class the old `z.number().int().nonnegative()`
    // (no `.max()`) let straight through into BigInt() in the consumer.
    const r = zMoneyMinorStringNonNeg.safeParse(2 ** 53 + 1);
    expect(r.success).toBe(false);
  });

  it("REGRESSION: rejects a wildly out-of-range number like 1e21", () => {
    const r = zMoneyMinorStringNonNeg.safeParse(1e21);
    expect(r.success).toBe(false);
  });

  it("rejects a negative amount", () => {
    const r = zMoneyMinorStringNonNeg.safeParse(-1);
    expect(r.success).toBe(false);
  });
});

describe("POST/PATCH /v1/parking/facilities — tariff fields end to end (route -> consumer -> Postgres)", () => {
  it("REGRESSION: rejects tariffPerHourMinor = 2**53 + 1 with 400, never reaching the consumer/BigInt", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/parking/facilities", headers: bearer(),
      payload: { ...baseFacilityBody, tariffPerHourMinor: 2 ** 53 + 1 },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("persists a tariff ABOVE Number.MAX_SAFE_INTEGER byte-for-byte exact when sent as a string", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const hdr = bearer();
    const bigTariff = "9223372036854775807"; // 2^63 - 1

    const created = await app.inject({
      method: "POST", url: "/v1/parking/facilities", headers: hdr,
      payload: { ...baseFacilityBody, tariffPerHourMinor: bigTariff },
    });
    expect(created.statusCode).toBe(202);
    await drain();

    const { id } = JSON.parse(created.body) as { id: string };
    const row = await facilitiesRepo.findById(id, T1);
    expect(row).not.toBeNull();
    // The whole point of the fix: this must be the EXACT bigint, not a value
    // that already lost precision by passing through a JS `number`.
    expect(row?.tariffPerHourMinor?.toString()).toBe(bigTariff);
    await app.close();
  });

  it("persists an ordinary tariff sent as a plain JSON number correctly (normal path unaffected)", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const created = await app.inject({
      method: "POST", url: "/v1/parking/facilities", headers: bearer(),
      payload: { ...baseFacilityBody, facilityName: "Camp Surface Lot", tariffPerHourMinor: 2000, tariffPerDayMinor: 15000 },
    });
    expect(created.statusCode).toBe(202);
    await drain();

    const { id } = JSON.parse(created.body) as { id: string };
    const row = await facilitiesRepo.findById(id, T1);
    expect(row?.tariffPerHourMinor).toBe(2000n);
    expect(row?.tariffPerDayMinor).toBe(15000n);
    await app.close();
  });

  it('a tariff of "0" (free parking) persists as 0n, not null (guards the truthy-check pitfall)', async () => {
    // `p.tariffPerHourMinor ? BigInt(...) : null` would treat 0 as falsy and
    // silently store null instead of a real, deliberate zero tariff.
    // facilities/consumer.ts now checks `!= null` instead — this proves it.
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const created = await app.inject({
      method: "POST", url: "/v1/parking/facilities", headers: bearer(),
      payload: { ...baseFacilityBody, facilityName: "Free Municipal Lot", tariffPerHourMinor: 0 },
    });
    expect(created.statusCode).toBe(202);
    await drain();

    const { id } = JSON.parse(created.body) as { id: string };
    const row = await facilitiesRepo.findById(id, T1);
    expect(row?.tariffPerHourMinor).toBe(0n);
    await app.close();
  });

  it("PATCH rejects an unsafe-integer tariff update the same way POST does", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const hdr = bearer();
    const created = await app.inject({
      method: "POST", url: "/v1/parking/facilities", headers: hdr,
      payload: { ...baseFacilityBody, facilityName: "Aundh Multi-Level" },
    });
    await drain();
    const { id } = JSON.parse(created.body) as { id: string };

    const patched = await app.inject({
      method: "PATCH", url: `/v1/parking/facilities/${id}`, headers: hdr,
      payload: { tariffPerDayMinor: 2 ** 53 + 1 },
    });
    expect(patched.statusCode).toBe(400);
    await app.close();
  });

  it("PATCH persists a large string tariff update exactly, mirroring create", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const hdr = bearer();
    const created = await app.inject({
      method: "POST", url: "/v1/parking/facilities", headers: hdr,
      payload: { ...baseFacilityBody, facilityName: "Deccan Gymkhana Lot" },
    });
    await drain();
    const { id } = JSON.parse(created.body) as { id: string };

    const bigAnnual = "4611686018427387903"; // 2^62 - 1
    const patched = await app.inject({
      method: "PATCH", url: `/v1/parking/facilities/${id}`, headers: hdr,
      payload: { annualPassMinor: bigAnnual },
    });
    expect(patched.statusCode).toBe(202);
    await drain();

    const row = await facilitiesRepo.findById(id, T1);
    expect(row?.annualPassMinor?.toString()).toBe(bigAnnual);
    await app.close();
  });
});

describe("parking-service — bookings: facility check, tariff-derived fee, ownership", () => {
  it("POST /v1/parking/bookings with an unknown facilityId -> 404, never reaching the command", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/parking/bookings", headers: bearer(["parking_user"]),
      payload: { facilityId: randomUUID(), vehicleNumber: "MH12AB1234", vehicleType: "car" },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("full booked -> active -> completed lifecycle bills the REAL facility tariff, and only the owner may act on it", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const admin = bearer(["parking_admin"], ACTOR);
    const owner = bearer(["parking_user"], ACTOR);
    const stranger = bearer(["parking_user"], OTHER_ACTOR);

    // Facility with a known hourly tariff.
    const facCreated = await app.inject({
      method: "POST", url: "/v1/parking/facilities", headers: admin,
      payload: { ...baseFacilityBody, facilityName: "Booking Lifecycle Lot", tariffPerHourMinor: 3000 },
    });
    await drain();
    const { id: facilityId } = JSON.parse(facCreated.body) as { id: string };

    // Booking created by `owner`.
    const bookingCreated = await app.inject({
      method: "POST", url: "/v1/parking/bookings", headers: owner,
      payload: { facilityId, vehicleNumber: "MH12CD5678", vehicleType: "car" },
    });
    expect(bookingCreated.statusCode).toBe(202);
    await drain();
    const { id: bookingId } = JSON.parse(bookingCreated.body) as { id: string };

    const afterCreate = await bookingsRepo.findById(bookingId, T1);
    expect(afterCreate?.status).toBe("booked");
    expect(afterCreate?.bookingNumber).toMatch(/^PKG-B\/ULB\/\d{4}\/\d{6}$/);

    // A stranger cannot see or act on this booking.
    const strangerGet = await app.inject({ method: "GET", url: `/v1/parking/bookings/${bookingId}`, headers: stranger });
    expect(strangerGet.statusCode).toBe(403);
    const strangerCancel = await app.inject({ method: "POST", url: `/v1/parking/bookings/${bookingId}/cancel`, headers: stranger });
    expect(strangerCancel.statusCode).toBe(403);

    // Record entry (staff action).
    const entry = await app.inject({ method: "POST", url: `/v1/parking/bookings/${bookingId}/entry`, headers: admin, payload: {} });
    expect(entry.statusCode).toBe(202);
    await drain();

    // Backdate entryTime by 90 minutes so exit computes a real, deterministic
    // fee (ceil(90/60) = 2 hours) instead of racing the clock in a fast test.
    const backdated = new Date(Date.now() - 90 * 60 * 1000);
    await runWithTenant(T1, () =>
      db.transaction((tx) =>
        bookingsRepo.updateStatus(tx as never, bookingId, T1, "active", ["active"], ACTOR, { entryTime: backdated }),
      ),
    );

    // Record exit (staff action) — must bill tariffPerHourMinor(3000) * 2 hours.
    const exit = await app.inject({ method: "POST", url: `/v1/parking/bookings/${bookingId}/exit`, headers: admin, payload: {} });
    expect(exit.statusCode).toBe(202);
    await drain();

    const completed = await bookingsRepo.findById(bookingId, T1);
    expect(completed?.status).toBe("completed");
    expect(completed?.amountMinor).toBe(6000n); // 3000 * 2 hours, exact bigint math

    // Owner CAN see their own completed booking.
    const ownerGet = await app.inject({ method: "GET", url: `/v1/parking/bookings/${bookingId}`, headers: owner });
    expect(ownerGet.statusCode).toBe(200);

    await app.close();
  });
});

describe("parking-service — enforcement: issue/pay/contest, and the deliberate tenant-scoped (not owner-scoped) design", () => {
  it("issuing officer creates a violation with a real computed fine and a well-formed violation number", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const officerHdr = bearer(["parking_admin"], OFFICER);

    const issued = await app.inject({
      method: "POST", url: "/v1/parking/violations", headers: officerHdr,
      payload: { vehicleNumber: "MH12EF9012", violationType: "no_ticket" },
    });
    expect(issued.statusCode).toBe(202);
    await drain();
    const { id } = JSON.parse(issued.body) as { id: string };

    const row = await enforcementRepo.findById(id, T1);
    expect(row?.status).toBe("issued");
    expect(row?.fineMinor).toBe(100000n); // Rs 1000, per calculateFineMinor("no_ticket")
    expect(row?.violationNumber).toMatch(/^PKG-V\/ULB\/\d{4}\/\d{6}$/);
    expect(row?.issuedBy).toBe(OFFICER);
    await app.close();
  });

  it("a DIFFERENT user in the same tenant (not the issuing officer) CAN pay the violation — tenant-scoped by design", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const officerHdr = bearer(["parking_admin"], OFFICER);
    const payer = bearer(["parking_user"], OTHER_ACTOR); // never the officer, never any prior actor

    const issued = await app.inject({
      method: "POST", url: "/v1/parking/violations", headers: officerHdr,
      payload: { vehicleNumber: "MH12GH3456", violationType: "expired" },
    });
    await drain();
    const { id } = JSON.parse(issued.body) as { id: string };

    // enforcement/routes.ts deliberately has no ownership check here: this
    // table has no citizen/vehicle-owner reference at all (issuedBy/createdBy
    // identify the OFFICER, not the offender) — see the NOTE at the top of
    // that file. Any authenticated user in the tenant paying/contesting is
    // the intended behaviour, not a gap. This test proves it actually works
    // that way, not just that nothing explicitly blocks it.
    const paid = await app.inject({
      method: "POST", url: `/v1/parking/violations/${id}/pay`, headers: payer,
      payload: { paymentRef: "UPI-TXN-001" },
    });
    expect(paid.statusCode).toBe(202);
    await drain();

    const row = await enforcementRepo.findById(id, T1);
    expect(row?.status).toBe("paid");
    await app.close();
  });

  it("contest follows the same tenant-scoped rule, and an invalid transition (paying an already-paid violation) is rejected 422", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const officerHdr = bearer(["parking_admin"], OFFICER);
    const contester = bearer(["parking_user"], ACTOR);

    const issued = await app.inject({
      method: "POST", url: "/v1/parking/violations", headers: officerHdr,
      payload: { vehicleNumber: "MH12IJ7890", violationType: "wrong_zone" },
    });
    await drain();
    const { id } = JSON.parse(issued.body) as { id: string };

    const contested = await app.inject({
      method: "POST", url: `/v1/parking/violations/${id}/contest`, headers: contester,
      payload: { reason: "Was inside the marked zone" },
    });
    expect(contested.statusCode).toBe(202);
    await drain();

    const row = await enforcementRepo.findById(id, T1);
    expect(row?.status).toBe("contested");

    // "contested" is terminal (see VALID_TRANSITIONS in enforcement/domain.ts)
    // — a second pay attempt must be rejected synchronously, not silently
    // queued.
    const payAfterContest = await app.inject({
      method: "POST", url: `/v1/parking/violations/${id}/pay`, headers: contester,
      payload: { paymentRef: "UPI-TXN-002" },
    });
    expect(payAfterContest.statusCode).toBe(422);
    await app.close();
  });
});

describe("parking-service — RLS cross-tenant isolation has real teeth at the DB layer", () => {
  it("a facility inserted under T2 is invisible under ambient tenant T1, even though the WHERE clause names T2 correctly", async () => {
    const facilityId = randomUUID();
    await runWithTenant(T2, () =>
      db.transaction(async (tx) => {
        await tx.insert((await import("../src/modules/facilities/schema.js")).parkingFacilities).values({
          id: facilityId,
          tenantId: T2,
          facilityName: "T2-Only Lot",
          facilityType: "surface",
          address: { line1: "X", city: "Pune", pin: "411001" },
          totalSpaces: 5,
          availableSpaces: 5,
          currency: "INR",
          status: "active",
          createdBy: ACTOR,
          updatedBy: ACTOR,
        });
      }),
    );

    // Ambient GUC is T1 here, NOT T2 — FORCE RLS must block this regardless
    // of the application code correctly passing tenantId=T2 in the WHERE
    // clause. This is exactly the class of bug the trade-service licence
    // verify endpoint hit: an app-level WHERE match is not enough on its own.
    const underWrongTenant = await runWithTenant(T1, () => facilitiesRepo.findById(facilityId, T2));
    expect(underWrongTenant).toBeNull();

    // Sanity: the row genuinely exists and IS visible under its real tenant.
    const underRightTenant = await runWithTenant(T2, () => facilitiesRepo.findById(facilityId, T2));
    expect(underRightTenant?.facilityName).toBe("T2-Only Lot");
  });

  it("HTTP GET for a T1 facility using a T2 bearer token returns 404, not another tenant's data", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const created = await app.inject({
      method: "POST", url: "/v1/parking/facilities", headers: bearer(["parking_admin"], ACTOR, T1),
      payload: { ...baseFacilityBody, facilityName: "T1-Only HTTP Lot" },
    });
    await drain();
    const { id } = JSON.parse(created.body) as { id: string };

    const crossTenantGet = await app.inject({
      method: "GET", url: `/v1/parking/facilities/${id}`, headers: bearer(["parking_admin"], ACTOR, T2),
    });
    expect(crossTenantGet.statusCode).toBe(404);

    await app.close();
  });
});

describe("parking-service — outbox idempotency", () => {
  it("replaying the same createFacility command messageId does not double-insert (markProcessed dedup)", async () => {
    const facilityId = randomUUID();
    const messageId = randomUUID();
    const msg = {
      messageId,
      type: "parking.facility.create",
      tenantId: T1,
      actorId: ACTOR,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: {
        id: facilityId,
        tenantId: T1,
        facilityName: "Idempotency Test Lot",
        facilityType: "surface",
        address: { line1: "X", city: "Pune", pin: "411001" },
        totalSpaces: 10,
      },
    };
    await queue.publish("parking.facility.create", msg);
    await queue.publish("parking.facility.create", msg); // exact same messageId, replayed
    await drain();

    const row = await facilitiesRepo.findById(facilityId, T1);
    expect(row).not.toBeNull();
    expect(row?.facilityName).toBe("Idempotency Test Lot");
    // If markProcessed didn't dedup (e.g. were it called outside the write
    // transaction, or after the insert instead of before it), the replay
    // would either throw on a duplicate primary key or silently reprocess —
    // exactly one clean row is the only correct outcome here.
  });
});
