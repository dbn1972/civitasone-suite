/**
 * Wave 2 per-service hardening pass — dedicated coverage (live DB) for:
 *   1. The new pre-accept checks in billing/routes.ts (connection must
 *      exist + be active; no duplicate bill for the same connection +
 *      billing period) and complaints/routes.ts (a supplied complaintId on
 *      POST /v1/sewerage/field-records must reference a real complaint).
 *   2. The money-precision-loss fix: amountMinor/feeMinor now use
 *      @civitasone/schemas' zMoneyMinorStringNonNeg codec end to end
 *      (route -> consumer -> Postgres bigint column), never a raw JS
 *      `number`.
 *   3. The number-collision fix: application/connection/bill/complaint/
 *      booking numbers are now reserved from real Postgres SEQUENCEs
 *      (migrations/0003_number_sequences.sql) instead of `Date.now()`.
 *
 * Uses its own tenant id range (…003/…004) to avoid colliding with
 * complaints-flow.integration.test.ts (…001) and
 * routes-health.integration.test.ts (…002) — this service's existing
 * convention of "no TRUNCATE, distinct tenant ids per file" (each vitest
 * test file gets its own worker but shares one real Postgres database).
 * RLS cross-tenant isolation with real teeth (bypassing every repo
 * function's own tenant_id filter) lives in its own file, tests/rls-raw.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { zMoneyMinorStringNonNeg } from "@civitasone/schemas";
import { buildApp } from "../src/app.js";
import { queue } from "../src/shared/infra.js";
import { sqlClient } from "../src/shared/db.js";
import { registerConnectionConsumers } from "../src/modules/connections/consumer.js";
import { registerBillingConsumers } from "../src/modules/billing/consumer.js";
import { registerDesludgingConsumers } from "../src/modules/desludging/consumer.js";
import { registerComplaintConsumers } from "../src/modules/complaints/consumer.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0000-4000-8000-000000000003";
const USER = "bbbbbbbb-0000-4000-8000-000000000003";
const ADMIN = "cccccccc-0000-4000-8000-000000000003";

function token(sub: string, roles: string[]) {
  return signToken({ sub, tid: TENANT, roles, sid: "test-session" }, SECRET, 3600);
}
const userAuth = { authorization: `Bearer ${token(USER, ["sewerage_user"])}`, "x-tenant-id": TENANT };
const adminAuth = { authorization: `Bearer ${token(ADMIN, ["sewerage_admin"])}`, "x-tenant-id": TENANT };

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerConnectionConsumers(queue);
  registerBillingConsumers(queue);
  registerDesludgingConsumers(queue);
  registerComplaintConsumers(queue);
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

// Walks a fresh connection application all the way to an ACTIVE connection
// and returns its id. Mirrors routes-health.integration.test.ts's helper of
// the same name (kept local — cross-file imports between vitest files that
// each get their own worker/DB-interleaving is avoided elsewhere in this
// service too).
async function createActiveConnection(): Promise<string> {
  const applyRes = await app.inject({
    method: "POST", url: "/v1/sewerage/connections/apply", headers: userAuth,
    payload: { connectionClass: "domestic", propertyRef: `PROP-${randomUUID()}` },
  });
  const applied = applyRes.json() as { id: string };
  await queue.drain();

  let current = (await app.inject({ method: "GET", url: `/v1/sewerage/connections/applications/${applied.id}`, headers: userAuth })).json().data;
  for (const next of ["feasibility_check", "estimate_issued", "payment_pending", "work_ordered"]) {
    await app.inject({
      method: "POST", url: `/v1/sewerage/connections/applications/${applied.id}/status`, headers: adminAuth,
      payload: { status: next, version: current.version },
    });
    await queue.drain();
    current = (await app.inject({ method: "GET", url: `/v1/sewerage/connections/applications/${applied.id}`, headers: userAuth })).json().data;
  }
  await app.inject({
    method: "POST", url: `/v1/sewerage/connections/applications/${applied.id}/activate`, headers: adminAuth,
    payload: { version: current.version },
  });
  await queue.drain();

  const [row] = await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return tx/* sql */`
      SELECT id FROM civitas_sewerage.sewerage_connections
      WHERE application_id = ${applied.id} AND tenant_id = ${TENANT}
      LIMIT 1
    `;
  });
  if (!row) throw new Error("connection row not found after activation");
  return row.id as string;
}

describe("billing — pre-accept checks (POST /v1/sewerage/bills)", () => {
  it("rejects a bill for a nonexistent connection with 404 CONNECTION_NOT_FOUND", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/sewerage/bills", headers: adminAuth,
      payload: { connectionId: randomUUID(), billingPeriod: "2026-08", amountMinor: 1000, dueDate: "2026-09-30" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("CONNECTION_NOT_FOUND");
  });

  it("rejects a bill for a connection that exists but is not active with 422 CONNECTION_NOT_ACTIVE", async () => {
    const connectionId = await createActiveConnection();
    // No public route ever moves a connection OUT of "active" today (only
    // applications have a status-walk route; connections/domain.ts's
    // CONN_TRANSITIONS exist but nothing in routes.ts/commands.ts reaches
    // them) — so a raw UPDATE, scoped through the same RLS session GUC
    // db.transaction() sets, is the only way to reach the state this
    // check exists to guard.
    await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      await tx`UPDATE civitas_sewerage.sewerage_connections SET status = 'suspended' WHERE id = ${connectionId}`;
    });

    const res = await app.inject({
      method: "POST", url: "/v1/sewerage/bills", headers: adminAuth,
      payload: { connectionId, billingPeriod: "2026-08", amountMinor: 1000, dueDate: "2026-09-30" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("CONNECTION_NOT_ACTIVE");
  });

  it("rejects a duplicate bill for the same connection + billing period with 409 DUPLICATE_BILL", async () => {
    const connectionId = await createActiveConnection();
    const payload = { connectionId, billingPeriod: "2026-11", amountMinor: 5000, dueDate: "2026-12-15" };

    const first = await app.inject({ method: "POST", url: "/v1/sewerage/bills", headers: adminAuth, payload });
    expect(first.statusCode).toBe(202);
    await queue.drain();

    const dup = await app.inject({ method: "POST", url: "/v1/sewerage/bills", headers: adminAuth, payload });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe("DUPLICATE_BILL");
  });

  it("a different billing period for the SAME connection is not treated as a duplicate", async () => {
    const connectionId = await createActiveConnection();
    const first = await app.inject({
      method: "POST", url: "/v1/sewerage/bills", headers: adminAuth,
      payload: { connectionId, billingPeriod: "2027-01", amountMinor: 5000, dueDate: "2027-02-15" },
    });
    expect(first.statusCode).toBe(202);
    await queue.drain();

    const second = await app.inject({
      method: "POST", url: "/v1/sewerage/bills", headers: adminAuth,
      payload: { connectionId, billingPeriod: "2027-02", amountMinor: 5000, dueDate: "2027-03-15" },
    });
    expect(second.statusCode).toBe(202);
  });
});

describe("field-records — pre-accept complaint existence check (POST /v1/sewerage/field-records)", () => {
  it("rejects a field record referencing a nonexistent complaint with 404 COMPLAINT_NOT_FOUND", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/sewerage/field-records", headers: adminAuth,
      payload: { complaintId: randomUUID(), workPerformed: "Cleared blockage" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("COMPLAINT_NOT_FOUND");
  });

  it("accepts a field record referencing a real complaint, and it persists", async () => {
    const createRes = await app.inject({
      method: "POST", url: "/v1/sewerage/complaints", headers: userAuth,
      payload: { complaintType: "blockage", description: "Test complaint for field record" },
    });
    const complaint = createRes.json() as { id: string };
    await queue.drain();

    const res = await app.inject({
      method: "POST", url: "/v1/sewerage/field-records", headers: adminAuth,
      payload: { complaintId: complaint.id, workPerformed: "Cleared blockage" },
    });
    expect(res.statusCode).toBe(202);
    await queue.drain();

    const [row] = await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      return tx/* sql */`
        SELECT complaint_id FROM civitas_sewerage.sewerage_field_records
        WHERE id = ${(res.json() as { id: string }).id} AND tenant_id = ${TENANT}
      `;
    });
    expect(row?.complaint_id).toBe(complaint.id);
  });

  it("accepts a field record with no complaintId at all (bookingId-only records remain valid)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/sewerage/field-records", headers: adminAuth,
      payload: { workPerformed: "Routine desludging field note" },
    });
    expect(res.statusCode).toBe(202);
  });
});

describe("zMoneyMinorStringNonNeg — the codec billing/desludging routes.ts now use", () => {
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

  it("REGRESSION: rejects an unsafe-integer JSON number (2^53 + 1) instead of silently truncating it", () => {
    const r = zMoneyMinorStringNonNeg.safeParse(2 ** 53 + 1);
    expect(r.success).toBe(false);
  });

  it("rejects a negative amount", () => {
    const r = zMoneyMinorStringNonNeg.safeParse(-1);
    expect(r.success).toBe(false);
  });
});

describe("money-precision regression — end to end (route -> consumer -> Postgres)", () => {
  it("REGRESSION: POST /v1/sewerage/bills rejects amountMinor = 2**53 + 1 with 400, never reaching the consumer/BigInt", async () => {
    const connectionId = await createActiveConnection();
    const res = await app.inject({
      method: "POST", url: "/v1/sewerage/bills", headers: adminAuth,
      payload: { connectionId, billingPeriod: "2027-05", amountMinor: 2 ** 53 + 1, dueDate: "2027-06-15" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("persists a bill amount ABOVE Number.MAX_SAFE_INTEGER byte-for-byte exact when sent as a string", async () => {
    const connectionId = await createActiveConnection();
    const bigAmount = "9223372036854775807"; // 2^63 - 1
    const genRes = await app.inject({
      method: "POST", url: "/v1/sewerage/bills", headers: adminAuth,
      payload: { connectionId, billingPeriod: "2027-06", amountMinor: bigAmount, dueDate: "2027-07-15" },
    });
    expect(genRes.statusCode).toBe(202);
    const bill = genRes.json() as { id: string };
    await queue.drain();

    const current = (await app.inject({ method: "GET", url: `/v1/sewerage/bills/${bill.id}`, headers: userAuth })).json().data;
    // The whole point of the fix: this must be the EXACT value, not one
    // that already lost precision by passing through a JS `number`.
    expect(current.amountMinor).toBe(bigAmount);
  });

  it('a desludging feeMinor of "0" (waived fee) persists as "0", not null (guards the truthy-check pitfall)', async () => {
    const bookRes = await app.inject({
      method: "POST", url: "/v1/sewerage/desludging", headers: userAuth,
      payload: { tankCapacityLitres: 500, feeMinor: 0 },
    });
    expect(bookRes.statusCode).toBe(202);
    const booking = bookRes.json() as { id: string };
    await queue.drain();

    const current = (await app.inject({ method: "GET", url: `/v1/sewerage/desludging/${booking.id}`, headers: userAuth })).json().data;
    expect(current.feeMinor).toBe("0");
  });

  it("an ordinary desludging fee sent as a plain JSON number persists correctly (normal path unaffected)", async () => {
    const bookRes = await app.inject({
      method: "POST", url: "/v1/sewerage/desludging", headers: userAuth,
      payload: { tankCapacityLitres: 2000, feeMinor: 75000 },
    });
    const booking = bookRes.json() as { id: string };
    await queue.drain();

    const current = (await app.inject({ method: "GET", url: `/v1/sewerage/desludging/${booking.id}`, headers: userAuth })).json().data;
    expect(current.feeMinor).toBe("75000");
  });
});

describe("number sequences — concurrent creates never collide (migrations/0003_number_sequences.sql)", () => {
  it("20 concurrent complaint creates all get distinct complaint numbers", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        app.inject({
          method: "POST", url: "/v1/sewerage/complaints", headers: userAuth,
          payload: { complaintType: "odour", description: "Concurrency probe" },
        }),
      ),
    );
    for (const r of results) expect(r.statusCode).toBe(202);
    await queue.drain();

    const numbers = new Set<string>();
    for (const r of results) {
      const { id } = r.json() as { id: string };
      const detail = (await app.inject({ method: "GET", url: `/v1/sewerage/complaints/${id}`, headers: userAuth })).json().data;
      expect(detail.complaintNumber).toMatch(/^SEWC-\d+$/);
      numbers.add(detail.complaintNumber);
    }
    expect(numbers.size).toBe(20);
  });

  it("20 concurrent desludging bookings all get distinct booking numbers", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        app.inject({
          method: "POST", url: "/v1/sewerage/desludging", headers: userAuth,
          payload: { tankCapacityLitres: 1000 },
        }),
      ),
    );
    for (const r of results) expect(r.statusCode).toBe(202);
    await queue.drain();

    const numbers = new Set<string>();
    for (const r of results) {
      const { id } = r.json() as { id: string };
      const detail = (await app.inject({ method: "GET", url: `/v1/sewerage/desludging/${id}`, headers: userAuth })).json().data;
      expect(detail.bookingNumber).toMatch(/^SEWD-\d+$/);
      numbers.add(detail.bookingNumber);
    }
    expect(numbers.size).toBe(20);
  });
});
