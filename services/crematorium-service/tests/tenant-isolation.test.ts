/**
 * Cross-tenant RLS isolation — proves the FORCE ROW LEVEL SECURITY /
 * tenant_isolation policies added in migrations/0001_initial.sql actually
 * hold for every domain table in this service (crematorium_facilities,
 * crematorium_bookings, crematorium_service_register all use the identical
 * policy shape), through the real HTTP + async-consumer path AND at the raw
 * SQL layer. Mirrors services/fire-service/tests/tenant-isolation.test.ts
 * (PR #1011) and services/animal-service/tests/tenant-isolation.test.ts
 * (PR #1007).
 *
 * These route-level assertions are intentionally strict (exact 404, not
 * "404 or 500"): app.ts's onRequest hooks always set the app.tenant_id GUC
 * from the caller's own verified JWT tenant for any authenticated request
 * (see the G2 hook added by PR #999), so a real authenticated cross-tenant
 * call never hits the "GUC missing" edge case — it must cleanly 404.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerFacilityConsumers } from "../src/modules/facilities/consumer.js";
import { registerBookingConsumers } from "../src/modules/bookings/consumer.js";
import { crematoriumBookings } from "../src/modules/bookings/schema.js";
import * as bookingsRepo from "../src/modules/bookings/repo.js";
import { hdr, waitFor, drainQueue, ADMIN_ROLES, CITIZEN_ROLES, TENANT_A, TENANT_B, ACTOR_A } from "./support.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerFacilityConsumers(queue);
  registerBookingConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

const facilityBody = {
  facilityName: "Isolation Test Facility",
  facilityType: "crematorium" as const,
  address: { line1: "1 Test St", city: "Pune", pin: "411001" },
  totalSlots: 4,
};

async function createActiveFacility(tenantId: string): Promise<string> {
  const create = await app.inject({ method: "POST", url: "/v1/crematorium/facilities", headers: hdr(ACTOR_A, tenantId, ADMIN_ROLES), payload: facilityBody });
  const id = (create.json() as { id: string }).id;
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/crematorium/facilities/${id}`, headers: hdr(ACTOR_A, tenantId, ADMIN_ROLES) })).statusCode === 200);
  return id;
}

describe("tenant isolation — facilities", () => {
  it("tenant B cannot read tenant A's facility by id, list excludes it, and cannot patch it", async () => {
    const id = await createActiveFacility(TENANT_A);

    const crossGet = await app.inject({ method: "GET", url: `/v1/crematorium/facilities/${id}`, headers: hdr(ACTOR_A, TENANT_B, ADMIN_ROLES) });
    expect(crossGet.statusCode).toBe(404);

    const crossList = await app.inject({ method: "GET", url: "/v1/crematorium/facilities", headers: hdr(ACTOR_A, TENANT_B, ADMIN_ROLES) });
    expect(crossList.statusCode).toBe(200);
    expect(crossList.json().data.find((f: { id: string }) => f.id === id)).toBeUndefined();

    const crossPatch = await app.inject({ method: "PATCH", url: `/v1/crematorium/facilities/${id}`, headers: hdr(ACTOR_A, TENANT_B, ADMIN_ROLES), payload: { totalSlots: 99 } });
    expect(crossPatch.statusCode).toBe(404);
    await drainQueue();
  });
});

describe("tenant isolation — bookings", () => {
  it("tenant B cannot read tenant A's booking by id, list excludes it, and cannot confirm/cancel it (CAS + RLS both scope to caller's tenant)", async () => {
    const facilityId = await createActiveFacility(TENANT_A);
    const create = await app.inject({
      method: "POST",
      url: "/v1/crematorium/bookings",
      headers: hdr(ACTOR_A, TENANT_A, CITIZEN_ROLES),
      payload: { facilityId, applicantName: "Test Applicant", applicantPhone: "9876543210", deceasedName: "Test Deceased", serviceType: "cremation", requestedDate: "2027-03-01" },
    });
    const id = (create.json() as { id: string }).id;
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/crematorium/bookings/${id}`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES) })).statusCode === 200);

    const crossGet = await app.inject({ method: "GET", url: `/v1/crematorium/bookings/${id}`, headers: hdr(ACTOR_A, TENANT_B, ADMIN_ROLES) });
    expect(crossGet.statusCode).toBe(404);

    const crossList = await app.inject({ method: "GET", url: "/v1/crematorium/bookings", headers: hdr(ACTOR_A, TENANT_B, ADMIN_ROLES) });
    expect(crossList.json().data.find((b: { id: string }) => b.id === id)).toBeUndefined();

    // findById scoped to TENANT_B sees nothing at this id -> pre-accept 404,
    // never reaches "wrong status" (422).
    const crossConfirm = await app.inject({ method: "POST", url: `/v1/crematorium/bookings/${id}/confirm`, headers: hdr(ACTOR_A, TENANT_B, ADMIN_ROLES), payload: { slotNumber: "S-1" } });
    expect(crossConfirm.statusCode).toBe(404);

    const crossCancel = await app.inject({ method: "POST", url: `/v1/crematorium/bookings/${id}/cancel`, headers: hdr(ACTOR_A, TENANT_B, ADMIN_ROLES) });
    expect(crossCancel.statusCode).toBe(404);

    const stillRequested = (await app.inject({ method: "GET", url: `/v1/crematorium/bookings/${id}`, headers: hdr(ACTOR_A, TENANT_A, ADMIN_ROLES) })).json().data;
    expect(stillRequested.status).toBe("requested");
    await drainQueue();
  });
});

/**
 * RLS defense-in-depth — WITH REAL TEETH, not just app-level filtering.
 *
 * Every test above goes through repo.findById(id, tenantId) / repo.list(
 * tenantId, ...), and EVERY one of those functions already puts
 * eq(table.tenantId, tenantId) in its own WHERE clause. That means those
 * tests pass even with RLS completely disabled — application code alone
 * already scopes every query correctly. They exercise the real HTTP path,
 * which has value, but they do NOT prove the database-level backstop
 * (FORCE ROW LEVEL SECURITY + the tenant_isolation policy) is doing
 * anything. Verified directly against this exact suite: temporarily
 * running `ALTER TABLE crematorium.crematorium_bookings NO FORCE ROW LEVEL
 * SECURITY` left every test above still green — proof that they alone
 * don't have teeth against an RLS regression, i.e. a future repo function
 * that forgets its own tenantId filter. (Restored immediately after with
 * `FORCE ROW LEVEL SECURITY`; not left disabled.)
 *
 * This test closes that gap: it queries the table directly with NO
 * tenant_id predicate in the query itself (`tx.select().from(table)`, no
 * .where() at all), relying ENTIRELY on the RLS policy + the app.tenant_id
 * GUC (set here via runWithTenant, the same mechanism app.ts's onRequest
 * hooks use for a real request) to scope the result. With FORCE ROW LEVEL
 * SECURITY in place, a session scoped to tenant B must see zero of tenant
 * A's rows here even though the query asked for everything.
 */
describe("RLS defense-in-depth — raw query, no app-level tenant filter", () => {
  it("a raw SELECT with no WHERE tenant_id clause, scoped only by the RLS GUC, returns none of another tenant's rows", async () => {
    const tenantARowId = randomUUID();
    await runWithTenant(TENANT_A, () =>
      db.transaction(async (tx) => {
        const bookingNumber = `CREM/RLSTEST/${new Date().getUTCFullYear()}/${String(
          await bookingsRepo.nextBookingNumber(tx),
        ).padStart(6, "0")}`;
        await tx.insert(crematoriumBookings).values({
          id: tenantARowId,
          tenantId: TENANT_A,
          bookingNumber,
          facilityId: randomUUID(),
          applicantName: "RLS Direct-Query Test Applicant",
          applicantPhone: "9876543210",
          deceasedName: "RLS Direct-Query Test Deceased",
          serviceType: "cremation",
          requestedDate: "2027-03-01",
          status: "requested",
          feeMinor: 50000n,
          currency: "INR",
          feePaid: false,
          createdBy: ACTOR_A,
          updatedBy: ACTOR_A,
        });
      }),
    );

    // Tenant B's session, querying with NO tenant_id predicate at all --
    // whatever scoping happens here comes ONLY from RLS + the GUC.
    const rowsVisibleToTenantB = await runWithTenant(TENANT_B, () =>
      db.transaction((tx) => tx.select().from(crematoriumBookings)),
    );
    expect(rowsVisibleToTenantB.find((r) => r.id === tenantARowId)).toBeUndefined();

    // Sanity check on the other side: tenant A's OWN session, same
    // no-predicate query, DOES see it -- proves this isn't just an empty
    // table or a broken GUC making everything invisible.
    const rowsVisibleToTenantA = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => tx.select().from(crematoriumBookings)),
    );
    expect(rowsVisibleToTenantA.find((r) => r.id === tenantARowId)).toBeDefined();
  });
});
