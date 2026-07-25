/**
 * CAP-054 webhook lifecycle — end-to-end integration against the live DB.
 * Proves: delivery REPLAY (new row, replay_of set), duplicate PROTECTION
 * (dedup unique index), and maker-checker HMAC SECRET ROTATION (request →
 * approve/reject, grace-window verification, requester-cannot-approve).
 *
 * Mirrors the shared-queue consumer wiring used by coverage-gap-closure.test.ts:
 * routes publish onto the shared infra queue; the webhook consumer is
 * registered on that same singleton so the route → command → consumer → DB
 * path runs in-process.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { type Queue, type Handler } from "@civitasone/queue";
import { signToken } from "@civitasone/auth";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { webhooks, webhookDeliveries, secretRotations } from "../src/modules/webhooks/schema.js";
import { registerWebhookConsumers } from "../src/modules/webhooks/consumer.js";
import { signPayload } from "../src/modules/webhooks/commands.js";
import { verifyWithRotation } from "../src/modules/webhooks/rotation.js";
import { queue as sharedQueue } from "../src/shared/infra.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET as string;
const T = "77777777-cafe-4000-8000-000000000010";
const MAKER = "77777777-cafe-4000-8000-0000000000a1";
const CHECKER = "77777777-cafe-4000-8000-0000000000b2";
const CHECKER2 = "77777777-cafe-4000-8000-0000000000c3";

function bearer(actorId: string, roles: string[] = ["super_admin"]) {
  return { authorization: `Bearer ${signToken({ sub: actorId, roles, tid: T } as never, SECRET)}` };
}

let wired = false;
function wireOnce(): void {
  if (wired) return;
  wired = true;
  const raw = sharedQueue.subscribe.bind(sharedQueue);
  (sharedQueue as Queue).subscribe = ((topic: string, handler: Handler) =>
    raw(topic, withTenantConsumer(handler) as Handler)) as typeof sharedQueue.subscribe;
  registerWebhookConsumers(sharedQueue);
}

async function waitFor<T2>(fn: () => Promise<T2>, ok: (v: T2) => boolean, timeoutMs = 5000, step = 100): Promise<T2> {
  const deadline = Date.now() + timeoutMs;
  let last: T2;
  do {
    last = await fn();
    if (ok(last)) return last;
    await new Promise((r) => setTimeout(r, step));
  } while (Date.now() < deadline);
  return last;
}

async function cleanup(): Promise<void> {
  await runWithTenant(T, () => db.transaction(async (tx) => {
    await tx.delete(secretRotations).where(eq(secretRotations.tenantId, T));
    await tx.delete(webhookDeliveries).where(eq(webhookDeliveries.tenantId, T));
    await tx.delete(webhooks).where(eq(webhooks.tenantId, T));
  }));
}

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); wireOnce(); await cleanup(); });
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });

async function createWebhook(): Promise<{ id: string; secret: string }> {
  const res = await app.inject({
    method: "POST", url: "/v1/admin/webhooks", headers: bearer(MAKER),
    payload: { url: "https://example.gov.in/hooks/cap054", events: ["tenant.updated"] },
  });
  expect(res.statusCode).toBe(202);
  const id = res.json().id as string;
  const secret = (res.json() as { secret: string }).secret;
  await waitFor(
    () => runWithTenant(T, () => db.transaction((tx) => tx.select().from(webhooks).where(eq(webhooks.id, id)))),
    (r) => r.length > 0,
  );
  return { id, secret };
}

describe("CAP-054 replay + duplicate protection", () => {
  it("replays a delivered delivery into a NEW row with replay_of set", async () => {
    const { id } = await createWebhook();

    // Seed a terminal (delivered) delivery via the test endpoint.
    const test = await app.inject({ method: "POST", url: `/v1/admin/webhooks/${id}/test`, headers: bearer(MAKER) });
    expect(test.statusCode).toBe(202);
    const seeded = await waitFor(
      () => runWithTenant(T, () => db.transaction((tx) => tx.select().from(webhookDeliveries).where(eq(webhookDeliveries.webhookId, id)))),
      (r) => r.length >= 1,
    );
    const original = seeded[0]!;

    const replay = await app.inject({
      method: "POST", url: `/v1/admin/webhooks/${id}/deliveries/${original.id}/replay`, headers: bearer(MAKER),
    });
    expect(replay.statusCode).toBe(202);

    const after = await waitFor(
      () => runWithTenant(T, () => db.transaction((tx) => tx.select().from(webhookDeliveries).where(eq(webhookDeliveries.webhookId, id)))),
      (r) => r.length >= 2,
    );
    const replayed = after.find((r) => r.replayOf === original.id);
    expect(replayed).toBeDefined();
    expect(replayed!.status).toBe("pending");
    expect(replayed!.id).not.toBe(original.id);
  });

  it("rejects replay of a non-terminal (pending) delivery with 409", async () => {
    const { id } = await createWebhook();
    const deliveryId = "77777777-cafe-4000-8000-0000000000d1";
    await runWithTenant(T, () => db.transaction((tx) => tx.insert(webhookDeliveries).values({
      id: deliveryId, webhookId: id, tenantId: T, eventType: "x", payload: {}, status: "pending", attempt: 1,
    })));
    const res = await app.inject({
      method: "POST", url: `/v1/admin/webhooks/${id}/deliveries/${deliveryId}/replay`, headers: bearer(MAKER),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("NOT_REPLAYABLE");
  });

  it("dedup unique index blocks a duplicate (webhook_id, event_id) live delivery", async () => {
    const { id } = await createWebhook();
    const eventId = "77777777-cafe-4000-8000-0000000000e9";
    await runWithTenant(T, () => db.transaction((tx) => tx.insert(webhookDeliveries).values({
      webhookId: id, tenantId: T, eventId, eventType: "tenant.updated", payload: { n: 1 }, status: "delivered", attempt: 1,
    })));
    let threw = false;
    try {
      await runWithTenant(T, () => db.transaction((tx) => tx.insert(webhookDeliveries).values({
        webhookId: id, tenantId: T, eventId, eventType: "tenant.updated", payload: { n: 2 }, status: "delivered", attempt: 1,
      })));
    } catch (e) {
      threw = true;
      expect((e as { code?: string }).code).toBe("23505"); // unique_violation
    }
    expect(threw).toBe(true);
  });
});

describe("CAP-054 secret rotation (maker-checker)", () => {
  it("maker requests, a DIFFERENT checker approves, secret swaps with grace window", async () => {
    const { id, secret: oldSecret } = await createWebhook();

    const req = await app.inject({
      method: "POST", url: `/v1/admin/webhooks/${id}/rotate-secret`, headers: bearer(MAKER),
      payload: { reason: "quarterly rotation" },
    });
    expect(req.statusCode).toBe(202);
    const rotationId = (req.json() as { rotationId: string }).rotationId;
    await waitFor(
      () => runWithTenant(T, () => db.transaction((tx) => tx.select().from(secretRotations).where(eq(secretRotations.id, rotationId)))),
      (r) => r.length > 0 && r[0]!.status === "pending",
    );

    // Maker cannot approve their own request.
    const selfApprove = await app.inject({
      method: "POST", url: `/v1/admin/webhooks/rotations/${rotationId}/decision`, headers: bearer(MAKER),
      payload: { decision: "approve" },
    });
    expect(selfApprove.statusCode).toBe(409);
    expect(selfApprove.json().code).toBe("MAKER_CHECKER");

    // A different checker approves.
    const approve = await app.inject({
      method: "POST", url: `/v1/admin/webhooks/rotations/${rotationId}/decision`, headers: bearer(CHECKER),
      payload: { decision: "approve" },
    });
    expect(approve.statusCode).toBe(202);

    const wh = await waitFor(
      () => runWithTenant(T, () => db.transaction((tx) => tx.select().from(webhooks).where(eq(webhooks.id, id)))),
      (r) => r.length > 0 && r[0]!.secret !== oldSecret,
    );
    const row = wh[0]!;
    expect(row.secret).not.toBe(oldSecret);
    expect(row.previousSecret).toBe(oldSecret);
    expect(row.secretRotatedAt).not.toBeNull();

    // Grace window: a signature made with the OLD secret still verifies.
    const body = JSON.stringify({ event: "tenant.updated" });
    const oldSig = signPayload(oldSecret, body);
    expect(verifyWithRotation(row.secret, row.previousSecret, body, oldSig)).toBe(true);
    // And the new secret verifies too.
    expect(verifyWithRotation(row.secret, row.previousSecret, body, signPayload(row.secret, body))).toBe(true);

    const rot = await runWithTenant(T, () => db.transaction((tx) => tx.select().from(secretRotations).where(eq(secretRotations.id, rotationId))));
    expect(rot[0]!.status).toBe("approved");
    expect(rot[0]!.decidedBy).toBe(CHECKER);
  });

  it("rejecting a rotation leaves the secret unchanged", async () => {
    const { id, secret: oldSecret } = await createWebhook();
    const req = await app.inject({
      method: "POST", url: `/v1/admin/webhooks/${id}/rotate-secret`, headers: bearer(MAKER),
    });
    const rotationId = (req.json() as { rotationId: string }).rotationId;
    await waitFor(
      () => runWithTenant(T, () => db.transaction((tx) => tx.select().from(secretRotations).where(eq(secretRotations.id, rotationId)))),
      (r) => r.length > 0 && r[0]!.status === "pending",
    );
    const reject = await app.inject({
      method: "POST", url: `/v1/admin/webhooks/rotations/${rotationId}/decision`, headers: bearer(CHECKER),
      payload: { decision: "reject" },
    });
    expect(reject.statusCode).toBe(202);
    const rot = await waitFor(
      () => runWithTenant(T, () => db.transaction((tx) => tx.select().from(secretRotations).where(eq(secretRotations.id, rotationId)))),
      (r) => r.length > 0 && r[0]!.status !== "pending",
    );
    expect(rot[0]!.status).toBe("rejected");
    const wh = await runWithTenant(T, () => db.transaction((tx) => tx.select().from(webhooks).where(eq(webhooks.id, id))));
    expect(wh[0]!.secret).toBe(oldSecret);
    expect(wh[0]!.previousSecret).toBeNull();
  });

  it("lists rotation requests filtered by status", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/webhooks/rotations?status=approved", headers: bearer(MAKER) });
    expect(res.statusCode).toBe(200);
    const rows = (res.json() as { data: Array<{ status: string }> }).data;
    expect(rows.every((r) => r.status === "approved")).toBe(true);
  });
});


/**
 * CAP-054 TOCTOU: two DISTINCT decide messages (an approve + a reject, different
 * messageIds) raced against the SAME pending rotation must not double-apply.
 *
 * This is a genuinely-concurrent test, not a serialized fake: the in-process
 * MemoryQueue delivers each publish on its own `setTimeout(0)` tick, and the
 * consumer opens a fresh `db.transaction` per message — so the two decisions run
 * on two distinct pooled Postgres connections against the live DB. The FOR UPDATE
 * row lock therefore actually blocks the second decider until the first commits;
 * it then reads the now-decided status and is rejected NOT_PENDING. The inbox
 * `markProcessed` does NOT help here because the two messageIds differ.
 */
async function requestPendingRotation(): Promise<{ id: string; oldSecret: string; rotationId: string }> {
  const { id, secret: oldSecret } = await createWebhook();
  const req = await app.inject({
    method: "POST", url: `/v1/admin/webhooks/${id}/rotate-secret`, headers: bearer(MAKER),
    payload: { reason: "toctou race" },
  });
  expect(req.statusCode).toBe(202);
  const rotationId = (req.json() as { rotationId: string }).rotationId;
  await waitFor(
    () => runWithTenant(T, () => db.transaction((tx) => tx.select().from(secretRotations).where(eq(secretRotations.id, rotationId)))),
    (r) => r.length > 0 && r[0]!.status === "pending",
  );
  return { id, oldSecret, rotationId };
}

function publishDecide(rotationId: string, decision: "approve" | "reject", deciderId: string): string {
  const messageId = randomUUID();
  void sharedQueue.publish("admin.webhook.rotate.decide", {
    messageId,
    type: "admin.webhook.rotate.decide",
    tenantId: T,
    actorId: deciderId,
    correlationId: randomUUID(),
    schemaVersion: "1.0",
    payload: { rotationId, tenantId: T, decision, deciderId },
  });
  return messageId;
}

// The MemoryQueue exposes its dead-letter sink; a NonRetryableError lands here.
type Dlq = Array<{ topic: string; error: string; msg: { messageId: string; payload: { rotationId?: string } } }>;
function dlqFor(rotationId: string): Dlq {
  const dlq = (sharedQueue as unknown as { dlq: Dlq }).dlq;
  return dlq.filter((e) => e.topic === "admin.webhook.rotate.decide" && e.msg.payload?.rotationId === rotationId);
}

describe("CAP-054 secret rotation — concurrent decide TOCTOU", () => {
  it("two concurrent decides (approve + reject) apply EXACTLY ONCE; the loser is NOT_PENDING", async () => {
    const { id, oldSecret, rotationId } = await requestPendingRotation();

    // Race an approve (CHECKER) and a reject (CHECKER2) — both != requester(MAKER),
    // distinct messageIds — dispatched together so both observe the pending row.
    const approveMsgId = publishDecide(rotationId, "approve", CHECKER);
    const rejectMsgId = publishDecide(rotationId, "reject", CHECKER2);

    // Wait until the rotation is terminal AND exactly one decide has dead-lettered.
    const rot = await waitFor(
      () => runWithTenant(T, () => db.transaction((tx) => tx.select().from(secretRotations).where(eq(secretRotations.id, rotationId)))),
      (r) => r.length > 0 && r[0]!.status !== "pending",
    );
    const loser = await waitFor(async () => dlqFor(rotationId), (d) => d.length >= 1);

    // Exactly ONE terminal status; the other decide was rejected, not applied.
    const finalStatus = rot[0]!.status;
    expect(["approved", "rejected"]).toContain(finalStatus);
    expect(loser.length).toBe(1); // exactly one loser dead-lettered
    expect(loser[0]!.error).toMatch(/NOT_PENDING/); // loser rejected: pending guard fired

    // The winner is whichever decision matches the terminal status; the loser's
    // messageId is the one that dead-lettered.
    const winnerMsgId = finalStatus === "approved" ? approveMsgId : rejectMsgId;
    const loserMsgId = finalStatus === "approved" ? rejectMsgId : approveMsgId;
    expect(loser[0]!.msg.messageId).toBe(loserMsgId);
    expect(rot[0]!.decidedBy).toBe(finalStatus === "approved" ? CHECKER : CHECKER2);

    // The webhook secret was swapped AT MOST once, consistent with the single
    // winning decision — never a double swap or an approve-after-reject.
    const wh = await runWithTenant(T, () => db.transaction((tx) => tx.select().from(webhooks).where(eq(webhooks.id, id))));
    const row = wh[0]!;
    if (finalStatus === "approved") {
      expect(row.secret).not.toBe(oldSecret);
      expect(row.previousSecret).toBe(oldSecret); // exactly one application: old -> grace slot
    } else {
      expect(row.secret).toBe(oldSecret); // reject won: secret untouched
      expect(row.previousSecret).toBeNull();
    }
    // winnerMsgId did NOT dead-letter.
    expect(dlqFor(rotationId).some((e) => e.msg.messageId === winnerMsgId)).toBe(false);
  });
});
