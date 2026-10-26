/**
 * Human-facing reference numbers (booking, lease, lease request, meeting diary, eFile-from-module) come from
 * Postgres SEQUENCEs (migrations/0054_reference_number_sequences.sql), not Date.now()/Math.random().
 *
 * Real Postgres, real registered consumers, a real MemoryQueue (retry + onOutcome semantics included):
 *  - 50 concurrent creates of each number type give 50 distinct persisted numbers in the new format;
 *  - a command whose first attempt fails inside the transaction is retried and persists exactly once;
 *  - a terminally failed create leaves an audited failure record (never a silent loss);
 *  - re-running the migration seeds past existing rows, never rewinds, and keeps FORCE RLS on.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { MemoryQueue, type Queue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { queue as appQueue } from "../src/shared/infra.js";
import { auditFailedCreate, formatNumber, istYear } from "../src/shared/numbers.js";
import { registerBookingConsumers } from "../src/modules/booking/consumer.js";
import { registerCitizenLeaseConsumers } from "../src/modules/citizen-lease/consumer.js";
import { registerCommitteeConsumers } from "../src/modules/committee/consumer.js";
import { registerLinkageConsumers } from "../src/modules/linkage/consumer.js";
import { raiseFileFromModule } from "../src/modules/linkage/commands.js";
import { COMMANDS } from "../src/topics.js";

const N = 50;
const TENANT = randomUUID();
const RETRY_TENANT = randomUUID();
const FAIL_TENANT = randomUUID();
const ACTOR = randomUUID();
const tenants = [TENANT, RETRY_TENANT, FAIL_TENANT];

const q = new MemoryQueue();

/** Same wrapping the worker applies: run each handler in the message's tenant context and forward options. */
function workerLike(base: MemoryQueue): Queue {
  return new Proxy(base as unknown as Queue, {
    get(target, prop, receiver) {
      if (prop === "subscribe") {
        return (topic: string, handler: (msg: { tenantId: string }) => Promise<void>, options?: unknown) =>
          (target as never as { subscribe: (...a: unknown[]) => void }).subscribe(
            topic, (msg: { tenantId: string }) => runWithTenant(msg.tenantId, () => handler(msg)), options);
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

async function publish(topic: string, tenantId: string, payload: Record<string, unknown>, messageId = randomUUID()): Promise<string> {
  await q.publish(topic, {
    messageId, type: topic, tenantId, actorId: ACTOR, correlationId: messageId, schemaVersion: "1.0", payload,
  } as never);
  return messageId;
}

async function rows<T = Record<string, unknown>>(tenantId: string, query: ReturnType<typeof sql>): Promise<T[]> {
  return (await runWithTenant(tenantId, () => db.transaction((tx) => tx.execute(query)))) as unknown as T[];
}

async function seedFacility(tenantId: string): Promise<string> {
  const id = randomUUID();
  await publish(COMMANDS.bookingFacilityCreate, tenantId, {
    id, tenantId, facilityName: "Town Hall", facilityType: "community_hall", ratePerHourMinor: 1000, currency: "INR",
  });
  await q.drain();
  return id;
}

const bookingPayload = (tenantId: string, facilityId: string, id = randomUUID()) => ({
  id, tenantId, facilityId, applicantName: "Asha", applicantPhone: "9999999999",
  eventDate: "2026-05-01", startTime: "10:00", endTime: "14:00", durationHours: 4,
});

beforeAll(() => {
  const wq = workerLike(q);
  registerBookingConsumers(wq);
  registerCitizenLeaseConsumers(wq);
  registerCommitteeConsumers(wq);
  // eFile-from-module: the command is published on the app's own queue.
  registerLinkageConsumers(workerLike(appQueue as unknown as MemoryQueue));
});

afterAll(async () => {
  for (const t of tenants) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      for (const stmt of [
        sql`DELETE FROM booking.estab_booking_calendar WHERE tenant_id = ${t}::uuid`,
        sql`DELETE FROM booking.estab_bookings WHERE tenant_id = ${t}::uuid`,
        sql`DELETE FROM booking.estab_facilities_catalog WHERE tenant_id = ${t}::uuid`,
        sql`DELETE FROM citizen_lease.estab_lease_requests WHERE tenant_id = ${t}::uuid`,
        sql`DELETE FROM citizen_lease.estab_leases WHERE tenant_id = ${t}::uuid`,
        sql`DELETE FROM citizen_lease.estab_lease_properties WHERE tenant_id = ${t}::uuid`,
      ]) await tx.execute(stmt);
    })).catch(() => undefined);
  }
  await sqlClient.end();
});

describe("number format", () => {
  it("is PREFIX-YYYY-000123 with the IST year", () => {
    expect(formatNumber("BK", 2026, 123)).toBe("BK-2026-000123");
    expect(formatNumber("MTG", 2026, 7, "/")).toBe("MTG/2026/000007");
    // 2025-12-31T19:00Z is already 2026-01-01 in IST.
    expect(istYear(new Date("2025-12-31T19:00:00Z"))).toBe(2026);
    expect(istYear(new Date("2025-12-31T17:00:00Z"))).toBe(2025);
  });
});

describe(`${N} concurrent creates give ${N} distinct persisted numbers`, () => {
  it("bookings", async () => {
    const facilityId = await seedFacility(TENANT);
    const ids = Array.from({ length: N }, () => randomUUID());
    await Promise.all(ids.map((id) => publish(COMMANDS.bookingCreate, TENANT, bookingPayload(TENANT, facilityId, id))));
    await q.drain();
    const got = await rows<{ n: string }>(TENANT, sql`SELECT booking_number AS n FROM booking.estab_bookings WHERE tenant_id = ${TENANT}::uuid`);
    expect(got.length).toBe(N);
    expect(new Set(got.map((r) => r.n)).size).toBe(N);
    for (const r of got) expect(r.n).toMatch(/^BK-\d{4}-\d{6}$/);
  });

  it("leases", async () => {
    const props = Array.from({ length: N }, () => randomUUID());
    await Promise.all(props.map((id) => publish(COMMANDS.leasePropertyCreate, TENANT, {
      id, tenantId: TENANT, propertyCode: `SHOP-${id.slice(0, 8)}`, propertyType: "shop", monthlyRentMinor: "7500000",
    })));
    await q.drain();
    await Promise.all(props.map((propertyId) => publish(COMMANDS.leaseCreate, TENANT, {
      id: randomUUID(), tenantId: TENANT, propertyId, tenantName: "Ravi Traders", tenantPhone: "9888877777",
      leaseStartDate: "2026-01-01", leaseEndDate: "2027-01-01", monthlyRentMinor: "7500000",
    })));
    await q.drain();
    const got = await rows<{ n: string }>(TENANT, sql`SELECT lease_number AS n FROM citizen_lease.estab_leases WHERE tenant_id = ${TENANT}::uuid`);
    expect(got.length).toBe(N);
    expect(new Set(got.map((r) => r.n)).size).toBe(N);
    for (const r of got) expect(r.n).toMatch(/^LS-\d{4}-\d{6}$/);
  });

  it("lease requests", async () => {
    const [lease] = await rows<{ id: string }>(TENANT, sql`SELECT id FROM citizen_lease.estab_leases WHERE tenant_id = ${TENANT}::uuid LIMIT 1`);
    await Promise.all(Array.from({ length: N }, () => publish(COMMANDS.leaseRequestSubmit, TENANT, {
      id: randomUUID(), tenantId: TENANT, leaseId: lease!.id, requestType: "renewal",
    })));
    await q.drain();
    const got = await rows<{ n: string }>(TENANT, sql`SELECT request_number AS n FROM citizen_lease.estab_lease_requests WHERE tenant_id = ${TENANT}::uuid`);
    expect(got.length).toBe(N);
    expect(new Set(got.map((r) => r.n)).size).toBe(N);
    for (const r of got) expect(r.n).toMatch(/^LR-\d{4}-\d{6}$/);
  });

  it("meeting diary numbers", async () => {
    const committeeId = randomUUID();
    await publish(COMMANDS.committeeCreate, TENANT, { id: committeeId, tenantId: TENANT, name: "Works Committee", chairRef: randomUUID() });
    await q.drain();
    await Promise.all(Array.from({ length: N }, (_, i) => publish(COMMANDS.meetingCreate, TENANT, {
      id: randomUUID(), committeeId, tenantId: TENANT, title: `Meeting ${i}`, whenAt: "2026-06-01T10:00:00.000Z",
    })));
    await q.drain();
    const got = await rows<{ n: string }>(TENANT, sql`SELECT dak_no AS n FROM files.estab_inward WHERE tenant_id = ${TENANT}::uuid AND dak_no LIKE 'MTG/%'`);
    expect(got.length).toBe(N);
    expect(new Set(got.map((r) => r.n)).size).toBe(N);
    for (const r of got) expect(r.n).toMatch(/^MTG\/\d{4}\/\d{6}$/);
  });

  it("eFile numbers raised from a module", async () => {
    const ctx = { tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), roles: ["admin"] } as never;
    const accepted = await Promise.all(Array.from({ length: N }, () => raiseFileFromModule(ctx, {
      refType: "finance_sanction", refId: randomUUID(), subject: "Disbursement approval", dept: "Grants",
      classification: "confidential", priority: "normal", currentWith: randomUUID(), initiatedBy: randomUUID(),
      approvalChain: "file_noting", initialNote: "Please approve",
    } as never)));
    expect(new Set(accepted.map((a) => a.fileNo)).size).toBe(N);
    await (appQueue as unknown as MemoryQueue).drain();
    const got = await rows<{ n: string }>(TENANT, sql`SELECT file_no AS n FROM files.estab_files WHERE tenant_id = ${TENANT}::uuid AND source_ref_type = 'finance_sanction'`);
    expect(got.length).toBe(N);
    expect(new Set(got.map((r) => r.n)).size).toBe(N);
    // The persisted number is exactly the one the caller was given in the 202.
    expect(new Set(got.map((r) => r.n))).toEqual(new Set(accepted.map((a) => a.fileNo)));
    for (const r of got) expect(r.n).toMatch(/^FIN\/\d{4}\/\d{6}$/);
  });
});

describe("a retried command persists exactly once", () => {
  it("first attempt fails inside the insert transaction; the retry re-allocates and the row exists once", async () => {
    const facilityId = await seedFacility(RETRY_TENANT);
    // One-shot failure: a SEQUENCE is non-transactional, so only the first insert attempt sees 1 and raises.
    await sqlClient.unsafe(`CREATE SEQUENCE IF NOT EXISTS booking.zz_fail_once_seq`);
    await sqlClient.unsafe(`SELECT setval('booking.zz_fail_once_seq', 1, false)`);
    await sqlClient.unsafe(`CREATE OR REPLACE FUNCTION booking.zz_fail_once() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF nextval('booking.zz_fail_once_seq') = 1 THEN RAISE EXCEPTION 'injected transient failure'; END IF; RETURN NEW; END $$`);
    await sqlClient.unsafe(`DROP TRIGGER IF EXISTS zz_fail_once ON booking.estab_bookings`);
    await sqlClient.unsafe(`CREATE TRIGGER zz_fail_once BEFORE INSERT ON booking.estab_bookings FOR EACH ROW
      WHEN (NEW.tenant_id = '${RETRY_TENANT}'::uuid) EXECUTE FUNCTION booking.zz_fail_once()`);
    try {
      const id = randomUUID();
      const messageId = await publish(COMMANDS.bookingCreate, RETRY_TENANT, bookingPayload(RETRY_TENANT, facilityId, id));
      await q.drain();
      const attempts = Number((await sqlClient.unsafe(`SELECT last_value FROM booking.zz_fail_once_seq`))[0]!.last_value);
      expect(attempts).toBeGreaterThanOrEqual(2); // it really was retried
      const got = await rows<{ n: string }>(RETRY_TENANT, sql`SELECT booking_number AS n FROM booking.estab_bookings WHERE id = ${id}::uuid`);
      expect(got.length).toBe(1);
      expect(got[0]!.n).toMatch(/^BK-\d{4}-\d{6}$/);
      const successAudits = await rows(RETRY_TENANT, sql`SELECT 1 FROM _outbox.messages WHERE topic = 'audit.event.record' AND payload->>'resourceId' = ${id} AND payload->>'outcome' = 'success'`);
      expect(successAudits.length).toBe(1);
      const failureAudits = await rows(RETRY_TENANT, sql`SELECT 1 FROM _outbox.messages WHERE topic = 'audit.event.record' AND correlation_id = ${messageId} AND payload->>'outcome' = 'failure'`);
      expect(failureAudits.length).toBe(0); // it recovered: no failure record
    } finally {
      await sqlClient.unsafe(`DROP TRIGGER IF EXISTS zz_fail_once ON booking.estab_bookings`);
      await sqlClient.unsafe(`DROP FUNCTION IF EXISTS booking.zz_fail_once()`);
      await sqlClient.unsafe(`DROP SEQUENCE IF EXISTS booking.zz_fail_once_seq`);
    }
  });

  it("re-delivering the same message id does not create a second row", async () => {
    const facilityId = await seedFacility(RETRY_TENANT);
    const id = randomUUID();
    const messageId = randomUUID();
    await publish(COMMANDS.bookingCreate, RETRY_TENANT, bookingPayload(RETRY_TENANT, facilityId, id), messageId);
    await q.drain();
    await publish(COMMANDS.bookingCreate, RETRY_TENANT, bookingPayload(RETRY_TENANT, facilityId, id), messageId);
    await q.drain();
    const got = await rows(RETRY_TENANT, sql`SELECT 1 FROM booking.estab_bookings WHERE id = ${id}::uuid`);
    expect(got.length).toBe(1);
  });
});

describe("terminal failure of a create command is audited, never silent", () => {
  it("a booking for a facility that does not exist is rejected and leaves an audit.event.record outcome=failure", async () => {
    const id = randomUUID();
    const messageId = await publish(COMMANDS.bookingCreate, FAIL_TENANT, bookingPayload(FAIL_TENANT, randomUUID(), id));
    await q.drain();
    expect((await rows(FAIL_TENANT, sql`SELECT 1 FROM booking.estab_bookings WHERE id = ${id}::uuid`)).length).toBe(0);
    const audit = await rows<{ payload: Record<string, any> }>(FAIL_TENANT, sql`SELECT payload FROM _outbox.messages WHERE topic = 'audit.event.record' AND correlation_id = ${messageId}`);
    expect(audit.length).toBe(1);
    expect(audit[0]!.payload.outcome).toBe("failure");
    expect(audit[0]!.payload.action).toBe("booking.create");
    expect(audit[0]!.payload.details.status).toBe("rejected");
  });

  it("onOutcome(failed) records a failure; onOutcome(succeeded) records nothing", async () => {
    const messageId = randomUUID();
    const hook = auditFailedCreate("lease.create", "lease").onOutcome!;
    await hook({ messageId, tenantId: FAIL_TENANT, topic: "t", status: "failed", reason: "boom" });
    expect((await rows(FAIL_TENANT, sql`SELECT 1 FROM _outbox.messages WHERE correlation_id = ${messageId} AND payload->>'outcome' = 'failure'`)).length).toBe(1);
    const ok = randomUUID();
    await hook({ messageId: ok, tenantId: FAIL_TENANT, topic: "t", status: "succeeded" });
    expect((await rows(FAIL_TENANT, sql`SELECT 1 FROM _outbox.messages WHERE correlation_id = ${ok}`)).length).toBe(0);
  });
});

describe("migration 0054 seeding survives FORCE RLS (runs as the owner with no tenant GUC)", () => {
  const migrationSql = readFileSync(fileURLToPath(new URL("../migrations/0054_reference_number_sequences.sql", import.meta.url)), "utf8");

  // The file carries its own BEGIN/COMMIT: run it on ONE reserved connection (the migration runner's shape).
  async function runMigrationFile() {
    const conn = await sqlClient.reserve();
    try { await conn.unsafe(migrationSql); } finally { conn.release(); }
  }

  it("a re-run seeds past the highest existing number, never rewinds, and leaves FORCE RLS on", async () => {
    const facilityId = await seedFacility(RETRY_TENANT);
    const id = randomUUID();
    await publish(COMMANDS.bookingCreate, RETRY_TENANT, bookingPayload(RETRY_TENANT, facilityId, id));
    await q.drain();
    await runWithTenant(RETRY_TENANT, () => db.transaction((tx) =>
      tx.execute(sql`UPDATE booking.estab_bookings SET booking_number = 'BK-2026-900000' WHERE id = ${id}::uuid`)));

    await sqlClient.unsafe(`SELECT setval('booking.booking_number_seq', 1, false)`); // as an unseeded sequence would be
    await runMigrationFile();
    const next = Number((await sqlClient.unsafe(`SELECT nextval('booking.booking_number_seq')::bigint AS n`))[0]!.n);
    expect(next).toBeGreaterThan(900000);

    // A second run never rewinds.
    await runMigrationFile();
    const after = Number((await sqlClient.unsafe(`SELECT nextval('booking.booking_number_seq')::bigint AS n`))[0]!.n);
    expect(after).toBeGreaterThan(next);

    // End to end: the next real booking number is above the seeded one.
    const id2 = randomUUID();
    await publish(COMMANDS.bookingCreate, RETRY_TENANT, bookingPayload(RETRY_TENANT, facilityId, id2));
    await q.drain();
    const [r] = await rows<{ n: string }>(RETRY_TENANT, sql`SELECT booking_number AS n FROM booking.estab_bookings WHERE id = ${id2}::uuid`);
    expect(Number(/(\d+)$/.exec(r!.n)![1])).toBeGreaterThan(900000);

    const force = await sqlClient.unsafe(`SELECT relname, relforcerowsecurity FROM pg_class WHERE oid IN (
      'files.estab_files'::regclass, 'files.estab_inward'::regclass, 'booking.estab_bookings'::regclass,
      'citizen_lease.estab_leases'::regclass, 'citizen_lease.estab_lease_requests'::regclass)`);
    expect(force.length).toBe(5);
    for (const f of force) expect((f as { relforcerowsecurity: boolean }).relforcerowsecurity).toBe(true);
  });
});
