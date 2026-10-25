/**
 * V4-C-04 (parking-service) -- reference numbers were built from
 * crypto.randomInt(1, 999999) into fleet-global UNIQUE columns, so two
 * independent records could draw the same suffix and the second insert failed
 * inside the consumer transaction after the caller already received 202.
 * randomInt is pinned to a constant here: any dependence on it collides
 * deterministically; numbers must come from a DB sequence instead.
 */
import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";

vi.mock("node:crypto", async (importOriginal) => {
  const orig = await importOriginal<typeof import("node:crypto")>();
  return { ...orig, randomInt: () => 4242 };
});

import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { tenantScoped } from "../src/shared/tenant-queue.js";
import { COMMANDS } from "../src/topics.js";
import { registerBookingConsumers } from "../src/modules/bookings/consumer.js";
import { registerEnforcementConsumers } from "../src/modules/enforcement/consumer.js";
import { registerPassConsumers } from "../src/modules/passes/consumer.js";
import { parkingFacilities } from "../src/modules/facilities/schema.js";
import { parkingBookings } from "../src/modules/bookings/schema.js";
import { parkingViolations } from "../src/modules/enforcement/schema.js";
import { parkingPasses } from "../src/modules/passes/schema.js";

const TENANTS = [randomUUID(), randomUUID()];
const ACTOR = randomUUID();
const TABLES = [parkingBookings, parkingViolations, parkingPasses] as const;
const NUMBER_COLUMN = new Map<unknown, string>([[parkingBookings, "bookingNumber"], [parkingViolations, "violationNumber"], [parkingPasses, "passNumber"]]);

function msg(type: string, tenantId: string, payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(), type, tenantId, actorId: ACTOR,
    correlationId: randomUUID(), schemaVersion: "1.0", payload: { tenantId, ...payload },
  };
}

async function clean() {
  for (const t of TENANTS) {
    await runWithTenant(t, () =>
      db.transaction(async (tx) => {
        await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
        await tx.delete(parkingFacilities).where(eq(parkingFacilities.tenantId, t));
        await tx.delete(parkingBookings).where(eq(parkingBookings.tenantId, t));
        await tx.delete(parkingViolations).where(eq(parkingViolations.tenantId, t));
        await tx.delete(parkingPasses).where(eq(parkingPasses.tenantId, t));
      }),
    );
  }
}

const FACILITY = new Map<string, string>(TENANTS.map((t) => [t, randomUUID()]));

const JOBS = [
  { cmd: COMMANDS.createBooking, table: parkingBookings, payload: (id: string, tenant: string) => ({ id, facilityId: FACILITY.get(tenant)!, vehicleNumber: "KA01AB1234", vehicleType: "car" }) },
  { cmd: COMMANDS.issueViolation, table: parkingViolations, payload: (id: string, tenant: string) => ({ id, vehicleNumber: "KA01AB1234", violationType: "no_ticket" }) },
  { cmd: COMMANDS.createPass, table: parkingPasses, payload: (id: string, tenant: string) => ({ id, facilityId: FACILITY.get(tenant)!, holderName: "Holder", vehicleNumber: "KA01AB1234", vehicleType: "car", passType: "monthly", validFrom: "2026-10-01" }) },
] as const;

beforeAll(clean);
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("V4-C-04 parking reference numbers never collide", () => {
  it("numbers are unique across tenants and record types even with randomInt pinned", async () => {
    const q = tenantScoped(new MemoryQueue());
  registerBookingConsumers(q);
  registerEnforcementConsumers(q);
  registerPassConsumers(q);
    for (const t of TENANTS) {
      await runWithTenant(t, () =>
        db.transaction((tx) =>
          tx.insert(parkingFacilities).values({
            id: FACILITY.get(t)!, tenantId: t, facilityName: "Lot", facilityType: "surface",
            address: { line1: "1 Road", city: "City", pin: "560001" }, totalSpaces: 10, availableSpaces: 10,
            monthlyPassMinor: 50000n, annualPassMinor: 500000n, createdBy: ACTOR, updatedBy: ACTOR,
          }),
        ),
      );
    }
    await q.start();
    const ids = new Map<unknown, string[]>();
    for (const t of TENANTS) {
      for (const job of JOBS) {
        const id = randomUUID();
        ids.set(job.table, [...(ids.get(job.table) ?? []), id]);
        await q.publish(job.cmd, msg(job.cmd, t, job.payload(id, t)));
        await q.drain();
      }
    }
    expect((q as unknown as MemoryQueue).dlq, "unique violations were swallowed into the DLQ").toHaveLength(0);
    await q.stop();

    const nums: string[] = [];
    for (const t of TENANTS) {
      for (const table of TABLES) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tb = table as any;
        const rows = await runWithTenant(t, () =>
          db.transaction((tx) => tx.select().from(tb).where(inArray(tb.id, ids.get(table) ?? []))),
        );
        const col = NUMBER_COLUMN.get(table)!;
        nums.push(...(rows as Array<Record<string, string>>).map((r) => r[col]!));
      }
    }
    expect(nums).toHaveLength(TENANTS.length * JOBS.length);
    expect(new Set(nums).size).toBe(nums.length);
  });
});
