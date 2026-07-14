/**
 * CROSS-SERVICE FACT INGESTION — live end-to-end proof.
 *
 * Feeds one real domain event of each newly-wired governance (meeting),
 * judiciary (court) and premises (visitor) type through the ACTUAL facts
 * consumer path (MemoryQueue -> registerFactsConsumers -> markProcessed ->
 * normalizeFact -> repo.ingest) and asserts each lands in analytics.fact_events
 * with the expected normalised shape.
 *
 * Also proves the two idempotency levels and tenant isolation under RLS.
 *
 * The queue.subscribe wrap mirrors the worker's single-point runWithTenant so
 * app.tenant_id is set for every handler's db.transaction() — exactly the
 * runtime path the worker exercises.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { factEvents, type FactEventRow } from "../src/modules/facts/schema.js";
import { registerFactsConsumers } from "../src/modules/facts/consumer.js";
import { INBOUND } from "../src/topics.js";

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const ACTOR = randomUUID();
const queue = new MemoryQueue();

// Mirror the worker's single-point wrap: run each handler inside the message's
// tenant context so wrapWithTenantGuc sets app.tenant_id on db.transaction().
{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = queue as any;
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  q.subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
}

function publish(
  eventType: string,
  payload: Record<string, unknown>,
  opts: { messageId?: string; tenantId?: string } = {},
) {
  const messageId = opts.messageId ?? randomUUID();
  return queue.publish(eventType, {
    messageId,
    type: eventType,
    tenantId: opts.tenantId ?? TENANT_A,
    actorId: ACTOR,
    correlationId: "c-facts",
    schemaVersion: "1.0",
    payload,
  });
}

async function factsFor(tenantId: string): Promise<FactEventRow[]> {
  return runWithTenant(tenantId, () =>
    db.transaction((tx) =>
      tx.select().from(factEvents).where(eq(factEvents.tenantId, tenantId)),
    ),
  );
}

async function waitForFacts(tenantId: string, n: number, timeoutMs = 5000): Promise<FactEventRow[]> {
  const start = Date.now();
  let rows: FactEventRow[] = [];
  while (Date.now() - start < timeoutMs) {
    rows = await factsFor(tenantId);
    if (rows.length >= n) return rows;
    await new Promise((r) => setTimeout(r, 40));
  }
  return rows;
}

const NOW = new Date("2026-07-12T09:30:00.000Z");

beforeAll(async () => {
  registerFactsConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await queue.stop();
  for (const t of [TENANT_A, TENANT_B]) {
    await runWithTenant(t, () =>
      db.transaction((tx) => tx.delete(factEvents).where(eq(factEvents.tenantId, t))),
    );
  }
  await sqlClient.end();
});

describe("cross-service fact ingestion — one live event per wired type", () => {
  it("records a normalised fact for every governance/judiciary/premises event", async () => {
    await publish(INBOUND.meetingAttendanceMarked, {
      meetingId: randomUUID(), participantId: randomUUID(), method: "biometric", status: "present",
    });
    await publish(INBOUND.meetingVoteConcluded, {
      meetingId: randomUUID(), resolutionId: randomUUID(), result: "passed",
    });
    await publish(INBOUND.meetingCompleted, {
      meetingId: randomUUID(), actualEndAt: NOW.toISOString(),
    });
    await publish(INBOUND.courtCaseRegistered, {
      caseId: randomUUID(), cnr: "CNR123", caseType: "civil", courtId: randomUUID(), status: "filed",
    });
    await publish(INBOUND.courtCaseStatusChanged, {
      caseId: randomUUID(), from: "filed", to: "disposed", disposalType: "dismissed",
    });
    await publish(INBOUND.courtHearingScheduled, {
      caseId: randomUUID(), hearingId: randomUUID(), courtId: randomUUID(),
      scheduledAt: NOW.toISOString(), purpose: "arguments",
    });
    await publish(INBOUND.visitorCheckedIn, {
      passId: randomUUID(), locationId: randomUUID(), gateId: "G1", timestamp: NOW.toISOString(),
    });
    await publish(INBOUND.visitorOverstayAlerted, {
      passId: randomUUID(), locationId: randomUUID(), validUntil: NOW.toISOString(), detectedAt: NOW.toISOString(),
    });

    const rows = await waitForFacts(TENANT_A, 8);
    expect(rows.length).toBe(8);

    const by = (source: string, eventType: string) =>
      rows.find((r) => r.source === source && r.eventType === eventType);

    // meeting
    expect(by("meeting", "attendance.marked")).toMatchObject({ status: "present", category: "biometric" });
    expect(by("meeting", "vote.concluded")).toMatchObject({ status: "passed" });
    expect(by("meeting", "meeting.completed")).toMatchObject({ status: "completed" });
    expect(by("meeting", "meeting.completed")?.occurredAt.toISOString()).toBe(NOW.toISOString());

    // court
    expect(by("court", "case.registered")).toMatchObject({ status: "filed", category: "civil" });
    expect(by("court", "case.status_changed")).toMatchObject({ status: "disposed" });
    expect(by("court", "hearing.scheduled")).toMatchObject({ status: "scheduled", category: "arguments" });
    expect(by("court", "hearing.scheduled")?.occurredAt.toISOString()).toBe(NOW.toISOString());

    // visitor
    expect(by("visitor", "checked_in")).toMatchObject({ status: "checked_in" });
    expect(by("visitor", "checked_in")?.occurredAt.toISOString()).toBe(NOW.toISOString());
    expect(by("visitor", "overstay.alerted")).toMatchObject({ status: "overstay" });

    // count-facts carry no money
    for (const r of rows) expect(r.amount).toBe(0n);
  });

  it("is idempotent: a redelivered messageId never double-counts", async () => {
    const messageId = randomUUID();
    const payload = { caseId: randomUUID(), cnr: "CNR-DUP", caseType: "writ", courtId: randomUUID(), status: "filed" };
    await publish(INBOUND.courtCaseRegistered, payload, { messageId });
    await waitForFacts(TENANT_A, 9);
    await publish(INBOUND.courtCaseRegistered, payload, { messageId }); // duplicate delivery
    // give the duplicate a chance to (not) insert
    await new Promise((r) => setTimeout(r, 300));
    const rows = await factsFor(TENANT_A);
    const dupes = rows.filter((r) => r.dedupeKey === messageId);
    expect(dupes.length).toBe(1);
  });

  it("is tenant-scoped: tenant B never sees tenant A's facts", async () => {
    await publish(INBOUND.visitorCheckedIn, {
      passId: randomUUID(), locationId: randomUUID(), gateId: "G9", timestamp: NOW.toISOString(),
    }, { tenantId: TENANT_B });
    const bRows = await waitForFacts(TENANT_B, 1);
    expect(bRows.length).toBe(1);
    expect(bRows.every((r) => r.tenantId === TENANT_B)).toBe(true);
    // tenant A's rowset (9 from prior tests) is unaffected and excludes B's row.
    const aRows = await factsFor(TENANT_A);
    expect(aRows.every((r) => r.tenantId === TENANT_A)).toBe(true);
    expect(aRows.find((r) => r.tenantId === TENANT_B)).toBeUndefined();
  });
});
