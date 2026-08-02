/**
 * INT-12 — bounce ingestion + suppression list: route authz/validation boundary
 * and the consumer's write path (classification, suppression, idempotency, DLQ).
 *
 * Route tests use app.inject() (no network). Consumer tests register the real
 * consumer against a MemoryQueue and assert the committed rows, exactly as
 * prefs-update.test.ts does.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq, and, inArray } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { blindIndex } from "../src/shared/pii-crypto.js";
import { bounceEvents, suppressionList, suppressionSettings } from "../src/modules/bounces/schema.js";
import { registerBounceConsumers } from "../src/modules/bounces/consumer.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "bbbb0001-1111-4000-8000-000000000001";
const OTHER_TENANT = "bbbb0002-2222-4000-8000-000000000002";
const ACTOR = "bbbbaaaa-1111-4000-8000-0000000000aa";
const DELIVERY = "bbbbdddd-1111-4000-8000-0000000000dd";
const SUPPRESSION_ID = "bbbb5555-1111-4000-8000-000000000055";
const SETTINGS_ID = "bbbb6666-1111-4000-8000-000000000066";

/** PII: only ever passed as input, never asserted in a response body or log. */
const RECIPIENT = "bounce.target@dept.gov.in";

function token(roles: string[], tid = TENANT): string {
  return signToken({ sub: ACTOR, tid, roles, sid: "sess-bounce" }, SECRET, 3600);
}
const bearer = (roles: string[], tid = TENANT) => ({ authorization: `Bearer ${token(roles, tid)}` });

/** Message ids this file has delivered, so cleanup can scope its reset. */
const deliveredMessageIds = new Set<string>();

async function cleanup(): Promise<void> {
  for (const t of [TENANT, OTHER_TENANT]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(bounceEvents).where(eq(bounceEvents.tenantId, t));
      await tx.delete(suppressionList).where(eq(suppressionList.tenantId, t));
      await tx.delete(suppressionSettings).where(eq(suppressionSettings.tenantId, t));
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
    }));
  }
  // _inbox.processed is a SHARED, non-tenant-scoped table. An unqualified
  // DELETE here would wipe the idempotency markers of every OTHER test file
  // running in parallel, which silently breaks their "second delivery is a
  // no-op" assertions. Only this file's own message ids are removed.
  if (deliveredMessageIds.size > 0) {
    await db.delete(processed).where(inArray(processed.messageId, [...deliveredMessageIds]));
    deliveredMessageIds.clear();
  }
}

/** Per-tenant threshold of 2 keeps the soft-bounce escalation test short. */
async function seedThreshold(threshold: number): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(suppressionSettings).values({
      id: SETTINGS_ID, tenantId: TENANT, softBounceThreshold: threshold,
      createdBy: ACTOR, updatedBy: ACTOR, version: 1,
    }).onConflictDoNothing();
  }));
}

async function seedSuppression(id: string, tenantId: string, recipient: string): Promise<void> {
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.insert(suppressionList).values({
      id, tenantId, recipient, recipientHash: blindIndex(recipient),
      channel: "email", reason: "hard_bounce", source: "bounce", softBounceCount: 0,
      createdBy: ACTOR, updatedBy: ACTOR, version: 1,
    }).onConflictDoNothing();
  }));
}

/**
 * Publish an envelope on a FRESH MemoryQueue each time. MemoryQueue de-dups by
 * topic+messageId internally, so re-using one instance would hide whether the
 * DATABASE-level idempotency guard (markProcessed) actually works.
 */
async function deliver(topic: string, messageId: string, payload: unknown): Promise<MemoryQueue> {
  deliveredMessageIds.add(messageId);
  const q = new MemoryQueue();
  registerBounceConsumers(q);
  await q.start();
  await q.publish(topic, {
    messageId, type: topic, tenantId: TENANT, actorId: ACTOR,
    correlationId: `corr-${messageId}`, schemaVersion: "1.0", payload,
  });
  await q.drain();
  await q.stop();
  return q;
}

beforeAll(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("POST /v1/notification/bounces — route boundary", () => {
  it("202 for an admin recording a classifiable bounce", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/bounces", headers: bearer(["notification_admin"]),
      payload: { recipient: RECIPIENT, smtpCode: "5.1.1", reason: "user unknown", deliveryId: DELIVERY },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe("accepted");
    expect(body.correlationId).toBeDefined();
    // The recipient is PII: it must not be echoed back.
    expect(res.body).not.toContain(RECIPIENT);
  });

  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/bounces",
      payload: { recipient: RECIPIENT, smtpCode: "550" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role with no bounce write permission", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/bounces", headers: bearer(["citizen"]),
      payload: { recipient: RECIPIENT, smtpCode: "550" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("403 for audit_officer — read-only roles may not ingest bounces", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/bounces", headers: bearer(["audit_officer"]),
      payload: { recipient: RECIPIENT, smtpCode: "550" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("400 when recipient is missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/bounces", headers: bearer(["tenant_admin"]),
      payload: { smtpCode: "550" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("400 when recipient is too short", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/bounces", headers: bearer(["tenant_admin"]),
      payload: { recipient: "a", smtpCode: "550" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for an unsupported channel", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/bounces", headers: bearer(["tenant_admin"]),
      payload: { recipient: RECIPIENT, smtpCode: "550", channel: "pigeon" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for a non-uuid deliveryId", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/bounces", headers: bearer(["tenant_admin"]),
      payload: { recipient: RECIPIENT, smtpCode: "550", deliveryId: "nope" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for a non-ISO occurredAt", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/bounces", headers: bearer(["tenant_admin"]),
      payload: { recipient: RECIPIENT, smtpCode: "550", occurredAt: "yesterday" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("422 with neither smtpCode nor reason — an unclassifiable bounce must never suppress", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/bounces", headers: bearer(["tenant_admin"]),
      payload: { recipient: RECIPIENT },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("UNCLASSIFIABLE_BOUNCE");
  });

  it("202 with only a reason (no smtpCode)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/bounces", headers: bearer(["super_admin"]),
      payload: { recipient: RECIPIENT, reason: "mailbox full" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });
});

describe("GET /v1/notification/suppressions — route boundary", () => {
  beforeAll(() => seedSuppression(SUPPRESSION_ID, TENANT, RECIPIENT));

  it("200 with the list envelope and no PII in the body", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/notification/suppressions?limit=50",
      headers: bearer(["notification_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toMatchObject({ page: 1, pageSize: 50 });
    expect(body.meta.total).toBeGreaterThanOrEqual(1);
    expect(body.data[0].recipient).toBeUndefined();
    expect(res.body).not.toContain(RECIPIENT);
  });

  it("computes the page number from offset", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/notification/suppressions?limit=10&offset=20",
      headers: bearer(["notification_admin"]),
    });
    await app.close();
    expect(res.json().meta.page).toBe(3);
  });

  it("200 for audit_officer (read role)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/notification/suppressions?limit=10",
      headers: bearer(["audit_officer"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("200 with activeOnly=false", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/notification/suppressions?limit=10&activeOnly=false",
      headers: bearer(["tenant_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("does not leak another tenant's suppressions", async () => {
    await seedSuppression("bbbb7777-2222-4000-8000-000000000077", OTHER_TENANT, "other@dept.gov.in");
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/notification/suppressions?limit=200",
      headers: bearer(["tenant_admin"], OTHER_TENANT),
    });
    await app.close();
    const ids = (res.json().data as Array<{ id: string }>).map((r) => r.id);
    expect(ids).not.toContain(SUPPRESSION_ID);
  });

  it("400 when limit is omitted — an unbounded list is never allowed", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/notification/suppressions", headers: bearer(["tenant_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 when limit exceeds the maximum page size", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/notification/suppressions?limit=500", headers: bearer(["tenant_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for a non-boolean activeOnly", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/notification/suppressions?limit=10&activeOnly=maybe",
      headers: bearer(["tenant_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/notification/suppressions?limit=10" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for an unauthorised role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/notification/suppressions?limit=10", headers: bearer(["citizen"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/notification/suppressions/check", () => {
  beforeAll(() => seedSuppression(SUPPRESSION_ID, TENANT, RECIPIENT));

  it("200 suppressed=true for a suppressed recipient", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/notification/suppressions/check?recipient=${encodeURIComponent(RECIPIENT)}`,
      headers: bearer(["notification_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.suppressed).toBe(true);
    expect(res.json().data.entry.id).toBe(SUPPRESSION_ID);
  });

  it("200 suppressed=false for an unknown recipient", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/notification/suppressions/check?recipient=nobody@dept.gov.in",
      headers: bearer(["notification_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ suppressed: false, entry: null });
  });

  it("matches case-insensitively via the blind index", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/notification/suppressions/check?recipient=${encodeURIComponent(RECIPIENT.toUpperCase())}`,
      headers: bearer(["notification_admin"]),
    });
    await app.close();
    expect(res.json().data.suppressed).toBe(true);
  });

  it("400 when recipient is missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/notification/suppressions/check", headers: bearer(["tenant_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/notification/suppressions/check?recipient=a@b.co",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for an unauthorised role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/notification/suppressions/check?recipient=a@b.co",
      headers: bearer(["citizen"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("DELETE /v1/notification/suppressions/:id", () => {
  it("202 for an admin releasing a suppression", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE", url: `/v1/notification/suppressions/${SUPPRESSION_ID}`,
      headers: bearer(["notification_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().id).toBe(SUPPRESSION_ID);
  });

  it("400 for a non-uuid id", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE", url: "/v1/notification/suppressions/not-a-uuid",
      headers: bearer(["notification_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: `/v1/notification/suppressions/${SUPPRESSION_ID}` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for audit_officer — release is a write", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE", url: `/v1/notification/suppressions/${SUPPRESSION_ID}`,
      headers: bearer(["audit_officer"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("bounce consumer — classification, suppression and idempotency", () => {
  beforeEach(cleanup);

  const HARD_MSG = "bbbb1111-1111-4000-8000-000000000101";

  async function rows() {
    return runWithTenant(TENANT, () => db.transaction(async (tx) => ({
      events: await tx.select().from(bounceEvents).where(eq(bounceEvents.tenantId, TENANT)),
      suppressions: await tx.select().from(suppressionList).where(eq(suppressionList.tenantId, TENANT)),
      outbox: await tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)),
    })));
  }

  it("a hard bounce writes the event, suppresses the recipient and emits events", async () => {
    await deliver(COMMANDS.recordBounce, HARD_MSG, {
      id: HARD_MSG, tenantId: TENANT, recipient: RECIPIENT, deliveryId: DELIVERY,
      smtpCode: "5.1.1", reason: "user unknown",
    });

    const { events, suppressions, outbox } = await rows();
    expect(events).toHaveLength(1);
    expect(events[0]?.classification).toBe("hard");
    // encryptedText() round-trips: the column holds ciphertext, the read decrypts.
    expect(events[0]?.recipient).toBe(RECIPIENT);
    expect(events[0]?.recipientHash).toBe(blindIndex(RECIPIENT));
    expect(suppressions).toHaveLength(1);
    expect(suppressions[0]?.reason).toBe("hard_bounce");
    expect(suppressions[0]?.releasedAt).toBeNull();

    const topics = outbox.map((m) => m.eventType);
    expect(topics).toContain(EVENTS.bounceRecorded);
    expect(topics).toContain(EVENTS.recipientSuppressed);
    expect(topics).toContain("audit.event.record");
    // The suppression event carries the blind index, never the address.
    const suppressed = outbox.find((m) => m.eventType === EVENTS.recipientSuppressed);
    expect(JSON.stringify(suppressed?.payload)).not.toContain(RECIPIENT);
  });

  it("processing the same messageId twice writes exactly one row (idempotency)", async () => {
    const payload = {
      id: HARD_MSG, tenantId: TENANT, recipient: RECIPIENT, smtpCode: "5.1.1", reason: "user unknown",
    };
    await deliver(COMMANDS.recordBounce, HARD_MSG, payload);
    const first = await rows();
    // A brand-new MemoryQueue, so the in-memory de-dup cannot mask the DB guard.
    await deliver(COMMANDS.recordBounce, HARD_MSG, payload);
    const second = await rows();

    expect(first.events).toHaveLength(1);
    expect(second.events).toHaveLength(1);
    expect(second.suppressions).toHaveLength(1);
    expect(second.outbox).toHaveLength(first.outbox.length);
  });

  it("an unknown-classification bounce is recorded but never suppressed", async () => {
    await deliver(COMMANDS.recordBounce, "bbbb1111-1111-4000-8000-000000000102", {
      id: "bbbb1111-1111-4000-8000-000000000102", tenantId: TENANT,
      recipient: RECIPIENT, reason: "the server did something inexplicable",
    });
    const { events, suppressions } = await rows();
    expect(events[0]?.classification).toBe("unknown");
    expect(suppressions).toHaveLength(0);
  });

  it("soft bounces suppress only once the per-tenant threshold is reached", async () => {
    await seedThreshold(2);

    await deliver(COMMANDS.recordBounce, "bbbb1111-1111-4000-8000-000000000103", {
      id: "bbbb1111-1111-4000-8000-000000000103", tenantId: TENANT,
      recipient: RECIPIENT, smtpCode: "4.2.1",
    });
    let state = await rows();
    expect(state.events).toHaveLength(1);
    expect(state.suppressions).toHaveLength(0);

    await deliver(COMMANDS.recordBounce, "bbbb1111-1111-4000-8000-000000000104", {
      id: "bbbb1111-1111-4000-8000-000000000104", tenantId: TENANT,
      recipient: RECIPIENT, smtpCode: "4.2.1",
    });
    state = await rows();
    expect(state.events).toHaveLength(2);
    expect(state.suppressions).toHaveLength(1);
    expect(state.suppressions[0]?.reason).toBe("soft_bounce_threshold");
    expect(state.suppressions[0]?.softBounceCount).toBe(2);
  });

  it("honours an explicit occurredAt", async () => {
    const when = "2026-01-15T10:30:00.000Z";
    await deliver(COMMANDS.recordBounce, "bbbb1111-1111-4000-8000-000000000105", {
      id: "bbbb1111-1111-4000-8000-000000000105", tenantId: TENANT,
      recipient: RECIPIENT, smtpCode: "550", occurredAt: when,
    });
    const { events } = await rows();
    expect(events[0]?.occurredAt.toISOString()).toBe(when);
  });

  it("defaults the channel to email", async () => {
    await deliver(COMMANDS.recordBounce, "bbbb1111-1111-4000-8000-000000000106", {
      id: "bbbb1111-1111-4000-8000-000000000106", tenantId: TENANT,
      recipient: RECIPIENT, smtpCode: "550",
    });
    const { events } = await rows();
    expect(events[0]?.channel).toBe("email");
  });

  it("records an explicit channel", async () => {
    await deliver(COMMANDS.recordBounce, "bbbb1111-1111-4000-8000-000000000107", {
      id: "bbbb1111-1111-4000-8000-000000000107", tenantId: TENANT,
      recipient: RECIPIENT, smtpCode: "550", channel: "sms",
    });
    const { events } = await rows();
    expect(events[0]?.channel).toBe("sms");
  });

  it("dead-letters a payload with no recipient instead of retrying forever", async () => {
    const q = await deliver(COMMANDS.recordBounce, "bbbb1111-1111-4000-8000-000000000108", {
      id: "bbbb1111-1111-4000-8000-000000000108", tenantId: TENANT, smtpCode: "550",
    });
    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toContain("recipient is required");
    expect((await rows()).events).toHaveLength(0);
  });

  it("dead-letters a blank recipient", async () => {
    const q = await deliver(COMMANDS.recordBounce, "bbbb1111-1111-4000-8000-000000000109", {
      id: "bbbb1111-1111-4000-8000-000000000109", tenantId: TENANT, recipient: "   ", smtpCode: "550",
    });
    expect(q.dlq).toHaveLength(1);
  });

  it("dead-letters an unparseable occurredAt", async () => {
    const q = await deliver(COMMANDS.recordBounce, "bbbb1111-1111-4000-8000-000000000110", {
      id: "bbbb1111-1111-4000-8000-000000000110", tenantId: TENANT,
      recipient: RECIPIENT, smtpCode: "550", occurredAt: "not-a-date",
    });
    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toContain("ISO-8601");
  });

  it("a repeated hard bounce refreshes the suppression rather than duplicating it", async () => {
    for (const msg of [
      "bbbb1111-1111-4000-8000-000000000111",
      "bbbb1111-1111-4000-8000-000000000112",
    ]) {
      await deliver(COMMANDS.recordBounce, msg, {
        id: msg, tenantId: TENANT, recipient: RECIPIENT, smtpCode: "5.1.1",
      });
    }
    const { events, suppressions } = await rows();
    expect(events).toHaveLength(2);
    expect(suppressions).toHaveLength(1);
  });
});

describe("suppression release consumer", () => {
  beforeEach(cleanup);

  it("releases the entry and emits the released event", async () => {
    await seedSuppression(SUPPRESSION_ID, TENANT, RECIPIENT);
    await deliver(COMMANDS.releaseSuppression, "bbbb2222-1111-4000-8000-000000000201", {
      id: SUPPRESSION_ID, tenantId: TENANT,
    });

    const state = await runWithTenant(TENANT, () => db.transaction(async (tx) => ({
      rows: await tx.select().from(suppressionList).where(eq(suppressionList.id, SUPPRESSION_ID)),
      outbox: await tx.select().from(outboxMessages)
        .where(and(eq(outboxMessages.tenantId, TENANT), eq(outboxMessages.eventType, EVENTS.suppressionReleased))),
    })));
    expect(state.rows[0]?.releasedAt).not.toBeNull();
    expect(state.rows[0]?.version).toBe(2);
    expect(state.outbox).toHaveLength(1);
  });

  it("a released recipient is no longer reported as suppressed", async () => {
    await seedSuppression(SUPPRESSION_ID, TENANT, RECIPIENT);
    await deliver(COMMANDS.releaseSuppression, "bbbb2222-1111-4000-8000-000000000202", {
      id: SUPPRESSION_ID, tenantId: TENANT,
    });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/notification/suppressions/check?recipient=${encodeURIComponent(RECIPIENT)}`,
      headers: bearer(["notification_admin"]),
    });
    await app.close();
    expect(res.json().data.suppressed).toBe(false);
  });

  it("releasing twice is idempotent — the second delivery changes nothing", async () => {
    await seedSuppression(SUPPRESSION_ID, TENANT, RECIPIENT);
    const MSG = "bbbb2222-1111-4000-8000-000000000203";
    await deliver(COMMANDS.releaseSuppression, MSG, { id: SUPPRESSION_ID, tenantId: TENANT });
    const first = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(suppressionList).where(eq(suppressionList.id, SUPPRESSION_ID))));
    const q = await deliver(COMMANDS.releaseSuppression, MSG, { id: SUPPRESSION_ID, tenantId: TENANT });
    const second = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(suppressionList).where(eq(suppressionList.id, SUPPRESSION_ID))));

    expect(second[0]?.version).toBe(first[0]?.version);
    expect(second[0]?.releasedAt?.getTime()).toBe(first[0]?.releasedAt?.getTime());
    // A redelivery must NOT be dead-lettered as "missing".
    expect(q.dlq).toHaveLength(0);
  });

  it("dead-letters a release for an id that does not exist", async () => {
    const q = await deliver(COMMANDS.releaseSuppression, "bbbb2222-1111-4000-8000-000000000204", {
      id: "bbbb9999-9999-4000-8000-000000000099", tenantId: TENANT,
    });
    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toContain("not found");
  });
});
