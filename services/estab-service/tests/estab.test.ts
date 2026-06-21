/**
 * estab-service test suite
 *
 * Test 1 — Noting immutability: second noting with same messageId is idempotent, body not overwritten.
 * Test 2 — Room overlap: booking same room for overlapping window → consumer emits estab.room.conflict.
 * Test 3 — RTI deadline: deadline = createdAt + 30 days.
 * Test 4 — CQRS: RTI create → queue → consumer → DB row with correct deadline.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { estabNotings } from "../src/modules/files/schema.js";
import { estabRtiRequests } from "../src/modules/legal/schema.js";
import { estabRoomBookings } from "../src/modules/facilities/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerFilesConsumers }     from "../src/modules/files/consumer.js";
import { registerFacilitiesConsumers } from "../src/modules/facilities/consumer.js";
import { registerLegalConsumers }     from "../src/modules/legal/consumer.js";
import { computeRtiDeadline } from "../src/modules/legal/domain.js";
import { EVENTS } from "../src/topics.js";

const ACTOR  = "00000000-aaaa-4000-8000-000000000001";
const TENANT = "11111111-aaaa-4000-8000-000000000002";
const FILE_1 = "22222222-bbbb-4000-8000-000000000001";
const NOTE_1 = "33333333-cccc-4000-8000-000000000001";
const MSG_NOTE_1 = "44444444-dddd-4000-8000-000000000001";
const ROOM_1 = "55555555-eeee-4000-8000-000000000001";
const BOOKING_1 = "66666666-ffff-4000-8000-000000000001";
const BOOKING_2 = "77777777-aaaa-4000-8000-000000000002";
const MSG_BOOK_1 = "88888888-bbbb-4000-8000-000000000001";
const MSG_BOOK_2 = "99999999-cccc-4000-8000-000000000002";
const RTI_1  = "aaaaaaaa-dddd-4000-8000-000000000001";
const MSG_RTI_1 = "bbbbbbbb-eeee-4000-8000-000000000001";

async function wipe() {
  await db.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
  await db.delete(estabNotings).where(eq(estabNotings.tenantId, TENANT));
  await db.delete(estabRoomBookings).where(eq(estabRoomBookings.tenantId, TENANT));
  await db.delete(estabRtiRequests).where(eq(estabRtiRequests.tenantId, TENANT));
  await db.delete(processed).where(eq(processed.messageId, MSG_NOTE_1));
  await db.delete(processed).where(eq(processed.messageId, MSG_BOOK_1));
  await db.delete(processed).where(eq(processed.messageId, MSG_BOOK_2));
  await db.delete(processed).where(eq(processed.messageId, MSG_RTI_1));
}

// ── 1. Noting immutability ─────────────────────────────────────────────────

describe("Noting — immutability (idempotency)", () => {
  beforeAll(async () => { await wipe(); });
  afterAll(async () => { await wipe(); });

  it("second noting add with same messageId does not overwrite body", async () => {
    const q = new MemoryQueue();
    registerFilesConsumers(q);
    await q.start();

    const notingMsg = {
      messageId: MSG_NOTE_1,
      type: "estab.noting.add",
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: "corr-noting-1",
      schemaVersion: "1.0",
      payload: { id: NOTE_1, fileId: FILE_1, tenantId: TENANT, body: "Original body", officerId: ACTOR },
    };

    await q.publish("estab.noting.add", notingMsg);
    await new Promise<void>((r) => setTimeout(r, 500));

    // Second publish with same messageId but different body — should be ignored
    await q.publish("estab.noting.add", {
      ...notingMsg,
      payload: { id: NOTE_1, fileId: FILE_1, tenantId: TENANT, body: "Tampered body", officerId: ACTOR },
    });
    await new Promise<void>((r) => setTimeout(r, 500));
    await q.stop();

    const rows = await db.select().from(estabNotings).where(eq(estabNotings.id, NOTE_1));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.body).toBe("Original body");
  });
});

// ── 2. Room overlap ────────────────────────────────────────────────────────

describe("Room booking — overlap conflict", () => {
  beforeAll(async () => { await wipe(); });
  afterAll(async () => { await wipe(); });

  it("booking same room for overlapping window emits estab.room.conflict", async () => {
    const q = new MemoryQueue();
    registerFacilitiesConsumers(q);
    await q.start();

    const from1 = "2026-07-01T10:00:00.000Z";
    const to1   = "2026-07-03T10:00:00.000Z";
    const from2 = "2026-07-02T10:00:00.000Z";
    const to2   = "2026-07-04T10:00:00.000Z";

    // First booking — should succeed
    await q.publish("estab.room.book", {
      messageId: MSG_BOOK_1,
      type: "estab.room.book",
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-room-1", schemaVersion: "1.0",
      payload: { id: BOOKING_1, roomId: ROOM_1, tenantId: TENANT, guestName: "Test Guest", checkIn: from1, checkOut: to1 },
    });
    await new Promise<void>((r) => setTimeout(r, 500));

    // Second booking — overlaps, should emit conflict
    await q.publish("estab.room.book", {
      messageId: MSG_BOOK_2,
      type: "estab.room.book",
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-room-2", schemaVersion: "1.0",
      payload: { id: BOOKING_2, roomId: ROOM_1, tenantId: TENANT, guestName: "Second Guest", checkIn: from2, checkOut: to2 },
    });
    await new Promise<void>((r) => setTimeout(r, 500));
    await q.stop();

    const bookings = await db.select().from(estabRoomBookings).where(eq(estabRoomBookings.tenantId, TENANT));
    expect(bookings).toHaveLength(1);
    expect(bookings[0]?.id).toBe(BOOKING_1);

    const outbox = await db.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    const eventTypes = outbox.map((r) => r.eventType);
    expect(eventTypes).toContain(EVENTS.roomConflict);
  });
});

// ── 3. RTI deadline — pure ────────────────────────────────────────────────

describe("RTI domain — deadline computation (pure)", () => {
  it("deadline is exactly 30 days after createdAt", () => {
    const created  = new Date("2026-01-01T00:00:00.000Z");
    const deadline = computeRtiDeadline(created);
    expect(deadline.toISOString().slice(0, 10)).toBe("2026-01-31");
  });

  it("handles month boundaries correctly", () => {
    const created  = new Date("2026-03-15T00:00:00.000Z");
    const deadline = computeRtiDeadline(created);
    expect(deadline.toISOString().slice(0, 10)).toBe("2026-04-14");
  });
});

// ── 3b. HTTP route auth guard (inject) ───────────────────────────────────

describe("estab-service route auth (inject)", () => {
  it("GET /v1/estab/dashboard without token → 401", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/estab/dashboard" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("GET /v1/estab/meetings without token → 401", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/estab/meetings" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("GET /v1/estab/vehicles without token → 401", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/estab/vehicles" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("GET /v1/estab/guesthouse-bookings without token → 401", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/estab/guesthouse-bookings" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("GET /v1/estab/room-bookings (alias) without token → 401", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/estab/room-bookings" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("GET /v1/estab/compliance without token → 401", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/estab/compliance" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

// ── 4. CQRS — RTI create wiring ───────────────────────────────────────────

describe("RTI CQRS — create wiring (integration)", () => {
  beforeAll(async () => { await wipe(); });
  afterAll(async () => {
    await wipe();
    await sqlClient.end();
  });

  it("estab.rti.create → consumer → DB row with 30-day deadline and rti.created in outbox", async () => {
    const q = new MemoryQueue();
    registerLegalConsumers(q);
    await q.start();

    await q.publish("estab.rti.create", {
      messageId: MSG_RTI_1,
      type: "estab.rti.create",
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-rti-1", schemaVersion: "1.0",
      payload: {
        id: RTI_1,
        tenantId: TENANT,
        rtiNo: "RTI/2026/001",
        applicant: "Ram Kumar",
        subject: "Information about road construction",
        cpioRef: ACTOR,
      },
    });

    await new Promise<void>((r) => setTimeout(r, 500));
    await q.stop();

    const rows = await db.select().from(estabRtiRequests).where(eq(estabRtiRequests.id, RTI_1));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rtiNo).toBe("RTI/2026/001");
    expect(rows[0]?.status).toBe("pending");

    // Deadline should be approximately today + 30 days (within a day tolerance for CI timing)
    const deadline = new Date(rows[0]?.deadline ?? "");
    const now = new Date();
    const diff = Math.round((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    expect(diff).toBeGreaterThanOrEqual(29);
    expect(diff).toBeLessThanOrEqual(30);

    // Inbox idempotency record
    const seen = await db.select().from(processed).where(eq(processed.messageId, MSG_RTI_1));
    expect(seen).toHaveLength(1);

    // Outbox should have estab.rti.created and audit event
    const outbox = await db.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    const eventTypes = outbox.map((r) => r.eventType);
    expect(eventTypes).toContain(EVENTS.rtiCreated);
    expect(eventTypes).toContain("audit.event.record");
  });
});
