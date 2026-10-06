/**
 * GAP-CDP-STEWARD-06 — steward decide consumer: merge semantics, audit trail and
 * idempotency, verified end-to-end against a real database (no mocks).
 *
 * The first-pass claim was "undeterminable (service absent)". The service is present
 * in this worktree, so these pin the real backend behaviour the gap asked about:
 *
 *   1. Approve atomically merges the two profiles — loser is marked `merged` with
 *      `attributes.mergedInto` pointing at the winner, and the loser's identity-graph
 *      edges are reassigned onto the winner — AND writes exactly one audit event
 *      (`steward.decide`) carrying the deciding actor's id, plus one domain event
 *      (`cdp.steward.merge_decided`), in the same transaction (outbox).
 *   2. A redelivery of the same command is idempotent: no second merge, no second
 *      audit row (markProcessed gate).
 *   3. Reject leaves BOTH profiles untouched (no merge), while still recording its own
 *      audit + event.
 *
 * Maker-checker note (recorded decision): merge candidates in cdp are produced by the
 * identity-resolution matching engine, not proposed by a human requester, so there is
 * no "requester == approver" case to forbid here — `createdBy` on a merge_queue row is
 * the engine/ingest actor, never the deciding steward. The authority that a *human*
 * must hold the steward role to decide at all is enforced at the route layer
 * (STEWARD_ROLES, cdp-routes.test.ts "403 — insufficient role"); this file covers the
 * consumer's data + audit guarantees.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { registerStewardConsumers } from "../src/modules/steward/consumer.js";
import { mergeQueue } from "../src/modules/steward/schema.js";
import { profiles } from "../src/modules/profiles/schema.js";
import { identityGraph } from "../src/modules/identity/schema.js";
import { outboxMessages } from "@civitasone/outbox";
import { COMMANDS, EVENTS } from "../src/topics.js";

const TENANT = "57ea0001-dead-4000-8000-000057ea0001";
const ENGINE_ACTOR = "57ea0001-dead-4000-8000-00000000e461"; // the matching engine that created the candidate
const STEWARD_ACTOR = "57ea0001-dead-4000-8000-0000000c7e5a"; // the human steward who decides

function makeMsg(type: string, payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(),
    type,
    tenantId: TENANT,
    actorId: STEWARD_ACTOR,
    correlationId: randomUUID(),
    schemaVersion: "1.0",
    payload,
  };
}

async function seedPendingMerge(opts: { withIdentityEdges?: boolean } = {}): Promise<{
  mergeId: string;
  sourceId: string;
  targetId: string;
  edgeId: string | null;
}> {
  const sourceId = randomUUID();
  const targetId = randomUUID();
  const mergeId = randomUUID();
  let edgeId: string | null = null;
  await runWithTenant(TENANT, async () => {
    await db.transaction(async (tx) => {
      await tx.insert(profiles).values([
        { id: sourceId, tenantId: TENANT, attributes: { name: "Asha Kumar", email: "asha@dept.gov.in" }, createdBy: ENGINE_ACTOR, updatedBy: ENGINE_ACTOR },
        { id: targetId, tenantId: TENANT, attributes: { name: "A. Kumar", phone: "9876543210" }, createdBy: ENGINE_ACTOR, updatedBy: ENGINE_ACTOR },
      ]);
      await tx.insert(mergeQueue).values({
        id: mergeId, tenantId: TENANT, sourceProfileId: sourceId, targetProfileId: targetId,
        confidence: "0.9000", status: "pending",
        createdBy: ENGINE_ACTOR, updatedBy: ENGINE_ACTOR, // created by the engine, not the steward
      });
      if (opts.withIdentityEdges) {
        edgeId = randomUUID();
        await tx.insert(identityGraph).values({
          id: edgeId, tenantId: TENANT, profileId: targetId,
          identifierType: "email", identifierHash: "hash:" + randomUUID(),
          createdBy: ENGINE_ACTOR, updatedBy: ENGINE_ACTOR,
        });
      }
    });
  });
  return { mergeId, sourceId, targetId, edgeId };
}

async function auditRowsFor(resourceId: string): Promise<Array<{ actorId: string; payload: Record<string, unknown> }>> {
  return runWithTenant(TENANT, async () =>
    db.transaction(async (tx) => {
      const rows = await tx.select().from(outboxMessages).where(
        and(
          eq(outboxMessages.tenantId, TENANT),
          eq(outboxMessages.topic, "audit.event.record"),
          sql`${outboxMessages.payload}->>'resourceId' = ${resourceId}`,
        ),
      );
      return rows.map((r) => ({ actorId: r.actorId, payload: r.payload }));
    }),
  );
}

async function mergeDecidedEventsFor(mergeId: string): Promise<Array<Record<string, unknown>>> {
  return runWithTenant(TENANT, async () =>
    db.transaction(async (tx) => {
      const rows = await tx.select().from(outboxMessages).where(
        and(
          eq(outboxMessages.tenantId, TENANT),
          eq(outboxMessages.topic, EVENTS.mergeDecided),
          sql`${outboxMessages.payload}->>'mergeRequestId' = ${mergeId}`,
        ),
      );
      return rows.map((r) => r.payload);
    }),
  );
}

async function profileRow(id: string): Promise<{ profileType: string; attributes: Record<string, unknown> } | null> {
  return runWithTenant(TENANT, async () =>
    db.transaction(async (tx) => {
      const rows = await tx.select().from(profiles).where(and(eq(profiles.id, id), eq(profiles.tenantId, TENANT))).limit(1);
      const r = rows[0];
      return r ? { profileType: r.profileType, attributes: r.attributes } : null;
    }),
  );
}

async function edgeProfileId(edgeId: string): Promise<string | null> {
  return runWithTenant(TENANT, async () =>
    db.transaction(async (tx) => {
      const rows = await tx.select().from(identityGraph).where(and(eq(identityGraph.id, edgeId), eq(identityGraph.tenantId, TENANT))).limit(1);
      return rows[0]?.profileId ?? null;
    }),
  );
}

async function runConsumer(msgs: ReturnType<typeof makeMsg>[]): Promise<void> {
  const q = new MemoryQueue();
  registerStewardConsumers(q);
  await q.start();
  for (const m of msgs) await q.publish(m.type, m);
  await q.drain();
  await q.stop();
}

describe("cdp steward decide consumer — merge semantics + audit (real DB, no mocks)", () => {
  it("approve: merges atomically, reassigns identity edges, and writes one audit event with the deciding steward", async () => {
    const { mergeId, sourceId, targetId, edgeId } = await seedPendingMerge({ withIdentityEdges: true });

    await runConsumer([makeMsg(COMMANDS.decideMerge, { mergeRequestId: mergeId, decision: "approve", reason: "same person", tenantId: TENANT })]);

    // Loser (target) is marked merged and points at the winner (source).
    const target = await profileRow(targetId);
    expect(target?.profileType).toBe("merged");
    expect(target?.attributes.mergedInto).toBe(sourceId);

    // Winner survives (not merged) and absorbed the loser's unique attribute.
    const sourceProfile = await profileRow(sourceId);
    expect(sourceProfile?.profileType).not.toBe("merged");
    expect(sourceProfile?.attributes.phone).toBe("9876543210");

    // Identity edge moved from loser onto winner.
    expect(await edgeProfileId(edgeId as string)).toBe(sourceId);

    // Exactly one audit event, carrying the deciding steward's id and decision=approved.
    const audits = await auditRowsFor(mergeId);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actorId).toBe(STEWARD_ACTOR);
    expect(audits[0]!.payload.action).toBe("steward.decide");
    expect((audits[0]!.payload.details as Record<string, unknown>).decision).toBe("approved");

    // Exactly one domain event announcing the decision.
    const events = await mergeDecidedEventsFor(mergeId);
    expect(events).toHaveLength(1);
    expect(events[0]!.decision).toBe("approved");
  });

  it("approve is idempotent on redelivery: no second merge, no second audit row", async () => {
    const { mergeId, targetId } = await seedPendingMerge();
    const msg = makeMsg(COMMANDS.decideMerge, { mergeRequestId: mergeId, decision: "approve", reason: "same person", tenantId: TENANT });

    // Deliver the SAME messageId twice.
    await runConsumer([msg, { ...msg }]);

    const target = await profileRow(targetId);
    expect(target?.profileType).toBe("merged");

    const audits = await auditRowsFor(mergeId);
    expect(audits).toHaveLength(1); // markProcessed gate — second delivery is a no-op
    const events = await mergeDecidedEventsFor(mergeId);
    expect(events).toHaveLength(1);
  });

  it("reject: leaves both profiles untouched (no merge) but still records audit + event", async () => {
    const { mergeId, sourceId, targetId } = await seedPendingMerge();

    await runConsumer([makeMsg(COMMANDS.decideMerge, { mergeRequestId: mergeId, decision: "reject", reason: "different people", tenantId: TENANT })]);

    // Neither profile became "merged".
    expect((await profileRow(sourceId))?.profileType).not.toBe("merged");
    const target = await profileRow(targetId);
    expect(target?.profileType).not.toBe("merged");
    expect(target?.attributes.mergedInto).toBeUndefined();

    const audits = await auditRowsFor(mergeId);
    expect(audits).toHaveLength(1);
    expect((audits[0]!.payload.details as Record<string, unknown>).decision).toBe("rejected");
    const events = await mergeDecidedEventsFor(mergeId);
    expect(events).toHaveLength(1);
    expect(events[0]!.decision).toBe("rejected");
  });
});
