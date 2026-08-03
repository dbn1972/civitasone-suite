/**
 * P1-3 — spam/abuse complaints must suppress future sends.
 *
 * Regression tests for the defect these cover: `chk_suppression_list_reason`
 * has permitted reason='complaint' since migration 0026, but no route, command,
 * consumer or table existed to produce one. A recipient who pressed "report
 * spam" was never suppressed and kept receiving mail.
 *
 * The load-bearing test is the last describe block: it drives the REAL send
 * consumer after a complaint and asserts that no channel adapter is invoked.
 * "A suppression row was written" and "no message left the process" are
 * different claims, and only the second one is the fix — the same reasoning
 * consent-gate-consumer.test.ts documents.
 *
 * Route tests use app.inject() (no network). Consumer tests register the real
 * consumer against a MemoryQueue and assert committed rows, as
 * bounces-routes.test.ts does.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { blindIndex } from "../src/shared/pii-crypto.js";
import { complaintEvents, suppressionList } from "../src/modules/bounces/schema.js";
import { registerBounceConsumers } from "../src/modules/bounces/consumer.js";
import { registerDeliveryConsumers } from "../src/modules/deliveries/consumer.js";
import { emailAdapter } from "../src/adapters/index.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import {
  COMPLAINT_FEEDBACK_TYPES,
  decideComplaintSuppression,
  normalizeFeedbackType,
} from "../src/modules/bounces/domain.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
/** A tenant of this file's own, so parallel suites cannot collide on fixtures. */
const TENANT = "bbbb0033-3333-4000-8000-000000000033";
const ACTOR = "bbbb0033-3333-4000-8000-0000000000aa";
const SYSTEM = "00000000-0000-0000-0000-000000000001";
const TEMPLATE = "bbbb0033-3333-4000-8000-0000000000cc";
const DELIVERY = "bbbb0033-3333-4000-8000-0000000000dd";

/** PII: only ever passed as input — never asserted in a response body or log. */
const COMPLAINANT = "complaint.target@dept.gov.in";

/**
 * `_inbox.processed.message_id` is a uuid column, so a readable slug like
 * "cmp-first" cannot be used as a message id. Fixed uuids (not randomUUID) keep
 * the idempotency tests meaningful — redelivering the SAME id is the whole
 * point — and cleanup() scopes its reset to exactly these values.
 */
const MSG = {
  first:        "bbbb0033-3333-4000-8000-000000000201",
  encrypted:    "bbbb0033-3333-4000-8000-000000000202",
  events:       "bbbb0033-3333-4000-8000-000000000203",
  unknownType:  "bbbb0033-3333-4000-8000-000000000204",
  idempotent:   "bbbb0033-3333-4000-8000-000000000205",
  repeatA:      "bbbb0033-3333-4000-8000-000000000206",
  repeatB:      "bbbb0033-3333-4000-8000-000000000207",
  releasedA:    "bbbb0033-3333-4000-8000-000000000208",
  releasedB:    "bbbb0033-3333-4000-8000-000000000209",
  noRecipient:  "bbbb0033-3333-4000-8000-000000000210",
  badDate:      "bbbb0033-3333-4000-8000-000000000211",
  e2eComplaint: "bbbb0033-3333-4000-8000-000000000220",
  e2eReleased:  "bbbb0033-3333-4000-8000-000000000221",
  sendBefore:   "bbbb0033-3333-4000-8000-000000000301",
  sendAfter:    "bbbb0033-3333-4000-8000-000000000302",
  sendReleased: "bbbb0033-3333-4000-8000-000000000303",
} as const;

function token(roles: string[], tid = TENANT): string {
  return signToken({ sub: ACTOR, tid, roles, sid: "sess-complaint" }, SECRET, 3600);
}
const bearer = (roles: string[], tid = TENANT) => ({ authorization: `Bearer ${token(roles, tid)}` });

/** Message ids this file has delivered, so cleanup can scope its reset. */
const deliveredMessageIds = new Set<string>();

/**
 * Domain tables have FORCED row-level security and the service role is
 * NOBYPASSRLS (#146), so direct seeding/inspection must set the app.tenant_id
 * GUC. Transaction-LOCAL, on a reserved connection.
 */
async function sqlAsTenant<T>(fn: (sql: typeof sqlClient) => Promise<T> | T): Promise<T> {
  return sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(sql as unknown as typeof sqlClient);
  }) as Promise<T>;
}

async function cleanup(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(complaintEvents).where(eq(complaintEvents.tenantId, TENANT));
    await tx.delete(suppressionList).where(eq(suppressionList.tenantId, TENANT));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
  }));
  await sqlAsTenant(async (sql) => {
    await sql`DELETE FROM deliveries.deliveries WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM templates.templates WHERE tenant_id = ${TENANT}`;
  });
  // _inbox.processed is a SHARED, non-tenant-scoped table. An unqualified DELETE
  // would wipe the idempotency markers of every other test file running in
  // parallel; only this file's own message ids are removed.
  if (deliveredMessageIds.size > 0) {
    await db.delete(processed).where(inArray(processed.messageId, [...deliveredMessageIds]));
    deliveredMessageIds.clear();
  }
}

/**
 * Publish an envelope on a FRESH MemoryQueue each time. MemoryQueue de-dups by
 * topic+messageId internally, so re-using one instance would hide whether the
 * DATABASE-level idempotency guard (markProcessed) actually works.
 */
async function deliverComplaint(messageId: string, payload: unknown): Promise<void> {
  deliveredMessageIds.add(messageId);
  const q = new MemoryQueue();
  registerBounceConsumers(q);
  await q.start();
  await q.publish(COMMANDS.recordComplaint, {
    messageId, type: COMMANDS.recordComplaint, tenantId: TENANT, actorId: ACTOR,
    correlationId: `corr-`, schemaVersion: "1.0", payload,
  });
  await q.drain();
  await q.stop();
}

async function complaintRows(): Promise<Array<Record<string, unknown>>> {
  return runWithTenant(TENANT, () => db.transaction((tx) =>
    tx.select().from(complaintEvents).where(eq(complaintEvents.tenantId, TENANT)),
  )) as unknown as Promise<Array<Record<string, unknown>>>;
}

async function suppressionRows(): Promise<Array<Record<string, unknown>>> {
  return runWithTenant(TENANT, () => db.transaction((tx) =>
    tx.select().from(suppressionList).where(eq(suppressionList.tenantId, TENANT)),
  )) as unknown as Promise<Array<Record<string, unknown>>>;
}

async function outboxRows(): Promise<Array<{ eventType: string; payload: unknown }>> {
  const rows = await db.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
  return rows.map((r) => ({ eventType: r.eventType, payload: r.payload }));
}

beforeAll(cleanup);
beforeEach(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("complaint feedback-type normalisation", () => {
  it("accepts every RFC 5965 type this service records", () => {
    for (const t of COMPLAINT_FEEDBACK_TYPES) {
      expect(normalizeFeedbackType(t)).toBe(t);
    }
  });

  it("canonicalises case and whitespace so an ESP's spelling is not lost", () => {
    expect(normalizeFeedbackType("  ABUSE ")).toBe("abuse");
    expect(normalizeFeedbackType("Fraud")).toBe("fraud");
  });

  it("collapses separators — 'not_spam' style labels reach a known form", () => {
    expect(normalizeFeedbackType("not_spam")).toBe("other");
  });

  it("degrades an unrecognised type to 'other' rather than dropping the complaint", () => {
    expect(normalizeFeedbackType("spam-o-tron-9000")).toBe("other");
  });

  it("returns null only for a value carrying no information", () => {
    expect(normalizeFeedbackType("")).toBeNull();
    expect(normalizeFeedbackType("   ")).toBeNull();
    expect(normalizeFeedbackType(undefined)).toBeNull();
    expect(normalizeFeedbackType(null)).toBeNull();
  });

  it("suppresses unconditionally — a complaint has no threshold", () => {
    expect(decideComplaintSuppression()).toEqual({ suppress: true, reason: "complaint" });
  });
});

describe("POST /v1/notification/complaints — route boundary", () => {
  it("202 for an admin recording a complaint", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/complaints", headers: bearer(["notification_admin"]),
      payload: { recipient: COMPLAINANT, feedbackType: "abuse", deliveryId: DELIVERY },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
    // The recipient is PII: it must not be echoed back.
    expect(res.body).not.toContain(COMPLAINANT);
  });

  it("202 with no feedbackType — not every ESP reports one", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/complaints", headers: bearer(["notification_admin"]),
      payload: { recipient: COMPLAINANT },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/complaints",
      payload: { recipient: COMPLAINANT },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role with no suppression write permission", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/complaints", headers: bearer(["citizen"]),
      payload: { recipient: COMPLAINANT },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("400 for a missing recipient", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/complaints", headers: bearer(["notification_admin"]),
      payload: { feedbackType: "abuse" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for a channel outside the supported set", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/complaints", headers: bearer(["notification_admin"]),
      payload: { recipient: COMPLAINANT, channel: "pigeon" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("complaint consumer — records the event and suppresses immediately", () => {
  it("one complaint suppresses the recipient with reason=complaint, source=complaint", async () => {
    await deliverComplaint(MSG.first, {
      id: "bbbb0033-3333-4000-8000-000000000101",
      tenantId: TENANT, recipient: COMPLAINANT, feedbackType: "abuse",
    });

    const complaints = await complaintRows();
    expect(complaints).toHaveLength(1);
    expect(complaints[0]?.feedbackType).toBe("abuse");
    expect(complaints[0]?.recipientHash).toBe(blindIndex(COMPLAINANT));

    const suppressions = await suppressionRows();
    expect(suppressions).toHaveLength(1);
    expect(suppressions[0]?.reason).toBe("complaint");
    expect(suppressions[0]?.source).toBe("complaint");
    expect(suppressions[0]?.releasedAt).toBeNull();
    // No threshold applies to a complaint, so there is no soft-bounce history.
    expect(suppressions[0]?.softBounceCount).toBe(0);
  });

  it("stores the recipient encrypted — the ciphertext is not the address", async () => {
    await deliverComplaint(MSG.encrypted, {
      id: "bbbb0033-3333-4000-8000-000000000102",
      tenantId: TENANT, recipient: COMPLAINANT,
    });
    const raw = await sqlAsTenant((sql) => sql`
      SELECT recipient FROM bounces.complaint_events WHERE tenant_id = ${TENANT}`) as unknown as
      Array<{ recipient: string }>;
    expect(raw).toHaveLength(1);
    expect(raw[0]?.recipient).not.toContain(COMPLAINANT);
  });

  it("emits complaintRecorded, recipientSuppressed and an audit event", async () => {
    await deliverComplaint(MSG.events, {
      id: "bbbb0033-3333-4000-8000-000000000103",
      tenantId: TENANT, recipient: COMPLAINANT, feedbackType: "fraud", deliveryId: DELIVERY,
    });
    const outbox = await outboxRows();
    const types = outbox.map((m) => m.eventType);
    expect(types).toContain(EVENTS.complaintRecorded);
    expect(types).toContain(EVENTS.recipientSuppressed);
    expect(types).toContain("audit.event.record");

    const recorded = outbox.find((m) => m.eventType === EVENTS.complaintRecorded)
      ?.payload as Record<string, unknown>;
    expect(recorded.feedbackType).toBe("fraud");
    expect(recorded.complaintCount).toBe(1);
    expect(recorded.deliveryId).toBe(DELIVERY);

    const suppressed = outbox.find((m) => m.eventType === EVENTS.recipientSuppressed)
      ?.payload as Record<string, unknown>;
    expect(suppressed.reason).toBe("complaint");
    expect(suppressed.complaintEventId).toBe("bbbb0033-3333-4000-8000-000000000103");
    expect(suppressed.bounceEventId).toBeNull();

    // PII: no event payload may carry the complainant's address.
    expect(JSON.stringify(outbox)).not.toContain(COMPLAINANT);
  });

  it("an unrecognised ESP feedback type is stored as 'other', not dropped", async () => {
    await deliverComplaint(MSG.unknownType, {
      id: "bbbb0033-3333-4000-8000-000000000104",
      tenantId: TENANT, recipient: COMPLAINANT, feedbackType: "Unsolicited-Bulk",
    });
    const complaints = await complaintRows();
    expect(complaints).toHaveLength(1);
    expect(complaints[0]?.feedbackType).toBe("other");
    // The suppression is what matters — an unfamiliar label must not cost it.
    expect(await suppressionRows()).toHaveLength(1);
  });

  it("processing the same messageId twice writes exactly one row (idempotency)", async () => {
    const payload = {
      id: "bbbb0033-3333-4000-8000-000000000105",
      tenantId: TENANT, recipient: COMPLAINANT, feedbackType: "abuse",
    };
    await deliverComplaint(MSG.idempotent, payload);
    await deliverComplaint(MSG.idempotent, payload);
    expect(await complaintRows()).toHaveLength(1);
    expect(await suppressionRows()).toHaveLength(1);
  });

  it("a second complaint refreshes the one suppression and counts both events", async () => {
    await deliverComplaint(MSG.repeatA, {
      id: "bbbb0033-3333-4000-8000-000000000106",
      tenantId: TENANT, recipient: COMPLAINANT, feedbackType: "abuse",
    });
    await deliverComplaint(MSG.repeatB, {
      id: "bbbb0033-3333-4000-8000-000000000107",
      tenantId: TENANT, recipient: COMPLAINANT, feedbackType: "virus",
    });
    expect(await complaintRows()).toHaveLength(2);
    // upsertSuppression conflicts on (tenant_id, recipient_hash).
    expect(await suppressionRows()).toHaveLength(1);

    const second = (await outboxRows())
      .filter((m) => m.eventType === EVENTS.complaintRecorded)
      .map((m) => (m.payload as Record<string, unknown>).complaintCount);
    expect(second).toContain(2);
  });

  it("re-suppresses a recipient whose earlier suppression had been released", async () => {
    await deliverComplaint(MSG.releasedA, {
      id: "bbbb0033-3333-4000-8000-000000000108",
      tenantId: TENANT, recipient: COMPLAINANT,
    });
    await sqlAsTenant((sql) => sql`
      UPDATE bounces.suppression_list SET released_at = now() WHERE tenant_id = ${TENANT}`);
    await deliverComplaint(MSG.releasedB, {
      id: "bbbb0033-3333-4000-8000-000000000109",
      tenantId: TENANT, recipient: COMPLAINANT,
    });
    const rows = await suppressionRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.releasedAt).toBeNull();
  });

  it("dead-letters a complaint with no recipient — no retry can supply one", async () => {
    const q = new MemoryQueue();
    registerBounceConsumers(q);
    await q.start();
    deliveredMessageIds.add(MSG.noRecipient);
    await q.publish(COMMANDS.recordComplaint, {
      messageId: MSG.noRecipient, type: COMMANDS.recordComplaint, tenantId: TENANT,
      actorId: ACTOR, correlationId: "corr-cmp-0010", schemaVersion: "1.0",
      payload: { id: "bbbb0033-3333-4000-8000-000000000110", tenantId: TENANT, recipient: "  " },
    });
    await q.drain();
    await q.stop();
    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toContain("INVALID_COMPLAINT_PAYLOAD");
    expect(await complaintRows()).toHaveLength(0);
  });

  it("dead-letters an unparseable occurredAt", async () => {
    const q = new MemoryQueue();
    registerBounceConsumers(q);
    await q.start();
    deliveredMessageIds.add(MSG.badDate);
    await q.publish(COMMANDS.recordComplaint, {
      messageId: MSG.badDate, type: COMMANDS.recordComplaint, tenantId: TENANT,
      actorId: ACTOR, correlationId: "corr-cmp-0011", schemaVersion: "1.0",
      payload: {
        id: "bbbb0033-3333-4000-8000-000000000111", tenantId: TENANT,
        recipient: COMPLAINANT, occurredAt: "last Tuesday",
      },
    });
    await q.drain();
    await q.stop();
    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toContain("INVALID_COMPLAINT_PAYLOAD");
  });
});

describe("P1-3 end-to-end — a complaint stops the next send reaching an adapter", () => {
  async function seedTemplate(): Promise<void> {
    await sqlAsTenant((sql) => sql`
      INSERT INTO templates.templates (id, tenant_id, channel, name, subject, body, created_by, updated_by)
      VALUES (${TEMPLATE}, ${TENANT}, 'email', 'Complaint gate', 'Subject', 'Body', ${SYSTEM}, ${SYSTEM})
      ON CONFLICT (id) DO UPDATE SET channel = 'email'`);
  }

  async function send(messageId: string): Promise<void> {
    deliveredMessageIds.add(messageId);
    const q = new MemoryQueue();
    registerDeliveryConsumers(q);
    await q.start();
    await q.publish(COMMANDS.sendNotification, {
      messageId, type: COMMANDS.sendNotification, tenantId: TENANT, actorId: ACTOR,
      correlationId: `corr-`, schemaVersion: "1.0",
      payload: { templateId: TEMPLATE, recipient: COMPLAINANT, channel: "email" },
    });
    await q.drain();
    await q.stop();
  }

  async function deliveryStatuses(): Promise<string[]> {
    const rows = await sqlAsTenant((sql) => sql`
      SELECT status FROM deliveries.deliveries WHERE tenant_id = ${TENANT}`) as unknown as
      Array<{ status: string }>;
    return rows.map((r) => r.status);
  }

  it("sends normally BEFORE any complaint — proves the test can observe a send", async () => {
    await seedTemplate();
    const spy = vi.spyOn(emailAdapter, "send").mockResolvedValue({ ok: true });
    try {
      await send(MSG.sendBefore);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(await deliveryStatuses()).toEqual(["delivered"]);
    } finally {
      spy.mockRestore();
    }
  });

  it("AFTER a complaint the send is skipped and NO adapter is invoked", async () => {
    await seedTemplate();
    await deliverComplaint(MSG.e2eComplaint, {
      id: "bbbb0033-3333-4000-8000-000000000120",
      tenantId: TENANT, recipient: COMPLAINANT, feedbackType: "abuse",
    });

    const spy = vi.spyOn(emailAdapter, "send").mockResolvedValue({ ok: true });
    try {
      await send(MSG.sendAfter);
      // The whole point of P1-3: no message left the process.
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    expect(await deliveryStatuses()).toEqual(["skipped"]);
  });

  it("releasing the complaint suppression lets sending resume", async () => {
    await seedTemplate();
    await deliverComplaint(MSG.e2eReleased, {
      id: "bbbb0033-3333-4000-8000-000000000121",
      tenantId: TENANT, recipient: COMPLAINANT,
    });
    await sqlAsTenant((sql) => sql`
      UPDATE bounces.suppression_list SET released_at = now() WHERE tenant_id = ${TENANT}`);

    const spy = vi.spyOn(emailAdapter, "send").mockResolvedValue({ ok: true });
    try {
      await send(MSG.sendReleased);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
