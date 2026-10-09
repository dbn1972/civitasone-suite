/**
 * GAP2-ESTAB-BOOKING-ORPHAN-01 — the booking + citizen-lease consumers were
 * missing entirely, so a published command never produced a DB row. This test
 * drives the registered consumers end to end against REAL Postgres and asserts
 * the write lands + an audit event is emitted. Fails on the old code (no
 * consumer existed; the modules were unmounted).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { estabFacilitiesCatalog, estabBookings } from "../src/modules/booking/schema.js";
import { estabLeaseProperties, estabLeases } from "../src/modules/citizen-lease/schema.js";
import { registerBookingConsumers } from "../src/modules/booking/consumer.js";
import { registerCitizenLeaseConsumers } from "../src/modules/citizen-lease/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "7ca10001-0000-4000-8000-0000000000d1";
const ACTOR = "7ca10001-0000-4000-8000-0000000000d2";

type Handler = (msg: Record<string, unknown>) => Promise<void>;
const handlers = new Map<string, Handler>();
const fakeQueue = { subscribe: (t: string, h: Handler) => void handlers.set(t, h) } as unknown as Queue;
const messageIds: string[] = [];

async function deliver(topic: string, payload: Record<string, unknown>, messageId = randomUUID()): Promise<void> {
  messageIds.push(messageId);
  const h = handlers.get(topic);
  if (!h) throw new Error("no handler " + topic);
  await runWithTenant(TENANT, () =>
    h({ messageId, type: topic, tenantId: TENANT, actorId: ACTOR, correlationId: "corr-bk", schemaVersion: "1.0", payload }));
}

async function audits(resourceId: string): Promise<Array<Record<string, unknown>>> {
  const rows = await sqlClient`SELECT payload FROM _outbox.messages WHERE tenant_id = ${TENANT} AND topic = 'audit.event.record' ORDER BY created_at`;
  return (rows as unknown as Array<{ payload: Record<string, unknown> }>).map((r) => r.payload).filter((p) => p.resourceId === resourceId);
}

beforeAll(() => { registerBookingConsumers(fakeQueue); registerCitizenLeaseConsumers(fakeQueue); });

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(estabBookings).where(eq(estabBookings.tenantId, TENANT));
    await tx.delete(estabFacilitiesCatalog).where(eq(estabFacilitiesCatalog.tenantId, TENANT));
    await tx.delete(estabLeases).where(eq(estabLeases.tenantId, TENANT));
    await tx.delete(estabLeaseProperties).where(eq(estabLeaseProperties.tenantId, TENANT));
  }));
  await sqlClient`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}`;
  if (messageIds.length) await sqlClient`DELETE FROM _inbox.processed WHERE message_id IN ${sqlClient(messageIds)}`;
  await sqlClient.end();
});

describe("booking consumer — CQRS write + money + audit", () => {
  it("creates a facility, then a booking whose amount derives from the facility rate", async () => {
    const facilityId = randomUUID();
    await deliver(COMMANDS.bookingFacilityCreate, {
      id: facilityId, tenantId: TENANT, facilityName: "Town Hall", facilityType: "community_hall",
      ratePerHourMinor: 100000, securityDepositMinor: 500000, currency: "INR",
    });
    const facRows = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(estabFacilitiesCatalog).where(eq(estabFacilitiesCatalog.id, facilityId))));
    expect(facRows).toHaveLength(1);
    expect(facRows[0]!.ratePerHourMinor).toBe(100000n);
    expect(await audits(facilityId)).toHaveLength(1);

    const bookingId = randomUUID();
    await deliver(COMMANDS.bookingCreate, {
      id: bookingId, tenantId: TENANT, facilityId, applicantName: "Asha", applicantPhone: "9999999999",
      eventDate: "2026-05-01", startTime: "10:00", endTime: "14:00", durationHours: 4,
    });
    const bkRows = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(estabBookings).where(eq(estabBookings.id, bookingId))));
    expect(bkRows).toHaveLength(1);
    const bk = bkRows[0]!;
    // amount = ratePerHour(100000) * 4h = 400000; total = + deposit 500000 = 900000
    expect(bk.amountMinor).toBe(400000n);
    expect(bk.securityDepositMinor).toBe(500000n);
    expect(bk.totalMinor).toBe(900000n);
    expect(bk.status).toBe("draft");
  });

  it("is idempotent on redelivery of the same messageId", async () => {
    const facilityId = randomUUID();
    const mid = randomUUID();
    const payload = { id: facilityId, tenantId: TENANT, facilityName: "Hall 2", facilityType: "auditorium" };
    await deliver(COMMANDS.bookingFacilityCreate, payload, mid);
    await deliver(COMMANDS.bookingFacilityCreate, payload, mid);
    const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(estabFacilitiesCatalog).where(eq(estabFacilitiesCatalog.id, facilityId))));
    expect(rows).toHaveLength(1);
  });
});

describe("citizen-lease consumer — CQRS write + money + audit", () => {
  it("creates a property, then a lease that marks the property leased", async () => {
    const propertyId = randomUUID();
    await deliver(COMMANDS.leasePropertyCreate, {
      id: propertyId, tenantId: TENANT, propertyCode: `SHOP-${propertyId.slice(0, 6)}`,
      propertyType: "shop", monthlyRentMinor: "7500000",
    });
    const propRows = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(estabLeaseProperties).where(eq(estabLeaseProperties.id, propertyId))));
    expect(propRows).toHaveLength(1);
    expect(propRows[0]!.monthlyRentMinor).toBe(7500000n);
    expect(await audits(propertyId)).toHaveLength(1);

    const leaseId = randomUUID();
    await deliver(COMMANDS.leaseCreate, {
      id: leaseId, tenantId: TENANT, propertyId, tenantName: "Ravi Traders", tenantPhone: "9888877777",
      leaseStartDate: "2026-01-01", leaseEndDate: "2027-01-01", monthlyRentMinor: "7500000",
    });
    const leaseRows = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(estabLeases).where(eq(estabLeases.id, leaseId))));
    expect(leaseRows).toHaveLength(1);
    expect(leaseRows[0]!.monthlyRentMinor).toBe(7500000n);

    const propAfter = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(estabLeaseProperties).where(eq(estabLeaseProperties.id, propertyId))));
    expect(propAfter[0]!.status).toBe("leased");
  });
});
