/**
 * TX-001 (parking-service slice) -- bookings module nested-transaction
 * connection-pool deadlock regression.
 *
 * Found via the ENTERPRISE-GAP-REPORT-2026-09-07.md TX-001 sweep (evidence
 * column cited `parking 2 (bookings:125,135)`, confirmed by an independent
 * manual scan of every db.transaction() block in this service -- 2 genuine
 * sites, both in bookings/consumer.ts's recordExit handler):
 *
 *   1. `repo.findById(p.id, msg.tenantId)`               (was line 125)
 *   2. `facilitiesRepo.findById(booking.facilityId, ...)` (was line 135)
 *
 * Both findById() functions are defined via this service's `scopedRead()`
 * helper (src/shared/db.ts), which is a bare `db.transaction(fn)` -- i.e.
 * every bare read repo function in this service already opens its OWN
 * transaction, same failure shape as estab/procurement's TX-001 fixes. Called
 * from INSIDE recordExit's already-open outer db.transaction(), each of these
 * needs a second, nested pool connection. Under pool.max concurrent in-flight
 * consumer transactions, no second connection is ever free and the whole
 * queue deadlocks silently forever.
 *
 * This test drives recordExit (parking.booking.exit) at pool.max + 3
 * concurrency, real Postgres, real pool, many citizens exiting bookings at
 * the SAME facility at once (a realistic trigger -- e.g. end of a business
 * day). Fixed by routing both reads onto repo.findByIdTx(tx, ...) /
 * facilitiesRepo.findByIdTx(tx, ...), reading through the caller's
 * already-open tx instead of opening a second one.
 *
 * Sabotage check (see PR body): reverting either call site back to the bare
 * findById() reproduces the drain timeout below.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { parkingBookings } from "../src/modules/bookings/schema.js";
import { parkingFacilities } from "../src/modules/facilities/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerBookingConsumers } from "../src/modules/bookings/consumer.js";
import { tenantScoped } from "../src/shared/tenant-queue.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "7a161000-dead-4000-8000-00000000f1a1";
const OFFICER = "7a161000-dead-4000-8000-0000000ac70a";
const FACILITY = "7a161000-dead-4000-8000-0000000000fa";
// pool.max defaults to 10 (packages/db/src/pool.ts, DB_POOL_MAX) when not
// routed through pgbouncer, which is exactly this test DB's connection style
// (vitest.config.ts DATABASE_URL points straight at Postgres). +3 to clear it.
const CONCURRENCY = 13;
const TARIFF_PER_HOUR_MINOR = 3000n; // Rs 30/hr
const ENTRY_MINUTES_AGO = 90; // -> ceil(90/60) = 2 billed hours

function makeMsg(bookingId: string) {
  return {
    messageId: randomUUID(), type: COMMANDS.recordExit, tenantId: TENANT,
    actorId: OFFICER, correlationId: randomUUID(), schemaVersion: "1.0",
    payload: { id: bookingId, tenantId: TENANT },
  };
}

async function clean() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
      // _inbox.processed has no tenantId column (just messageId + processedAt,
      // see packages/outbox/src/index.ts) -- messageIds here are always fresh
      // randomUUID()s per test run, so there is nothing of this tenant's to
      // clean there (same as estab-service's TX-001 deadlock test precedent).
      await tx.delete(parkingBookings).where(eq(parkingBookings.tenantId, TENANT));
      await tx.delete(parkingFacilities).where(eq(parkingFacilities.tenantId, TENANT));
    }),
  );
}

let bookingIds: string[] = [];

beforeAll(async () => {
  await clean();
  const entryTime = new Date(Date.now() - ENTRY_MINUTES_AGO * 60 * 1000);
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.insert(parkingFacilities).values({
        id: FACILITY, tenantId: TENANT, facilityName: "TX-001 Deadlock Fixture Lot",
        facilityType: "surface", address: { line1: "X", city: "Pune", pin: "411001" },
        totalSpaces: CONCURRENCY, availableSpaces: CONCURRENCY,
        tariffPerHourMinor: TARIFF_PER_HOUR_MINOR, currency: "INR", status: "active",
        createdBy: OFFICER, updatedBy: OFFICER,
      });
      bookingIds = Array.from({ length: CONCURRENCY }, () => randomUUID());
      for (const [i, id] of bookingIds.entries()) {
        await tx.insert(parkingBookings).values({
          id, tenantId: TENANT, bookingNumber: `PKG-B/TX001/${i}`, facilityId: FACILITY,
          vehicleNumber: `MH12ZZ${String(i).padStart(4, "0")}`, vehicleType: "car",
          entryTime, status: "active", currency: "INR",
          createdBy: OFFICER, updatedBy: OFFICER,
        });
      }
    }),
  );
});

afterAll(async () => { await clean(); await sqlClient.end(); });

describe("bookings consumer recordExit -- nested-transaction pool-exhaustion deadlock (real DB, no mocks)", () => {
  it(
    `${CONCURRENCY} concurrent recordExit commands across different bookings at the same facility drain without deadlocking the connection pool`,
    async () => {
      const q = tenantScoped(new MemoryQueue());
      registerBookingConsumers(q);
      await q.start();

      await Promise.all(bookingIds.map((id) => q.publish(COMMANDS.recordExit, makeMsg(id))));

      const DRAIN_TIMEOUT_MS = 10_000;
      let timedOut = false;
      await Promise.race([
        q.drain(),
        new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, DRAIN_TIMEOUT_MS)),
      ]);
      expect(timedOut, `queue did not drain within ${DRAIN_TIMEOUT_MS}ms -- nested-tx pool deadlock regressed`).toBe(false);
      // MemoryQueue.deliver() swallows handler errors into q.dlq instead of
      // rejecting -- assert the DLQ is empty so a silent per-command failure
      // (e.g. every command timing out on the pool and erroring out) isn't
      // masked by a "drained" queue.
      expect((q as MemoryQueue).dlq, `handler errors were swallowed into the DLQ: ${JSON.stringify((q as MemoryQueue).dlq)}`).toHaveLength(0);
      await q.stop();

      const rows = await runWithTenant(TENANT, () =>
        db.transaction((tx) => tx.select().from(parkingBookings).where(inArray(parkingBookings.id, bookingIds))),
      );
      expect(rows).toHaveLength(CONCURRENCY);
      for (const row of rows) {
        // Every booking must have completed AND been billed the real,
        // tariff-derived fee -- proving the fix didn't just avoid the
        // deadlock but that both nested reads (booking + facility tariff)
        // actually landed correctly for every concurrent handler.
        expect(row.status, `booking ${row.id} did not complete`).toBe("completed");
        expect(row.amountMinor, `booking ${row.id} was not billed the real tariff`).toBe(6000n);
      }
    },
    { timeout: 20_000 },
  );
});
