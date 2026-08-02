/**
 * CR-MKT-06 (keyword auto-responses) + F.5 (human handoff): routes and consumer.
 *
 * Also proves the gap this lane closed: notification.inbox.inbound_received was
 * published by inbound-routes.ts with nothing subscribed to it. It now drives
 * the keyword matcher, and the auto-reply is published as a normal
 * notification.send so it still passes through consent/DND/suppression.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq, and, inArray } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { blindIndex } from "../src/shared/pii-crypto.js";
import {
  keywordRules,
  inboundAutoResponses,
  conversationHandoffs,
  handoffAudit,
} from "../src/modules/inbox/keyword-schema.js";
import { registerInboxConsumers } from "../src/modules/inbox/consumer.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "ffff0001-1111-4000-8000-000000000001";
const ACTOR = "ffffaaaa-1111-4000-8000-0000000000aa";
const AGENT = "ffffbbbb-2222-4000-8000-0000000000bb";
const RULE_ID = "ffff1111-1111-4000-8000-000000000011";
const CONV = "ffff2222-1111-4000-8000-000000000022";
const UNKNOWN = "ffff9999-9999-4000-8000-000000000099";

/** PII: an inbound sender. Stored encrypted, never asserted in a log or event. */
const SENDER = "+919812345678";

function token(roles: string[], tid = TENANT): string {
  return signToken({ sub: ACTOR, tid, roles, sid: "sess-inbox" }, SECRET, 3600);
}
const bearer = (roles: string[], tid = TENANT) => ({ authorization: `Bearer ${token(roles, tid)}` });

/** Message ids this file has delivered, so cleanup can scope its reset. */
const deliveredMessageIds = new Set<string>();

async function cleanup(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(inboundAutoResponses).where(eq(inboundAutoResponses.tenantId, TENANT));
    await tx.delete(keywordRules).where(eq(keywordRules.tenantId, TENANT));
    await tx.delete(handoffAudit).where(eq(handoffAudit.tenantId, TENANT));
    await tx.delete(conversationHandoffs).where(eq(conversationHandoffs.tenantId, TENANT));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
  }));
  // _inbox.processed is a SHARED, non-tenant-scoped table. An unqualified
  // DELETE here would wipe the idempotency markers of every OTHER test file
  // running in parallel, which silently breaks their "second delivery is a
  // no-op" assertions. Only this file's own message ids are removed.
  if (deliveredMessageIds.size > 0) {
    await db.delete(processed).where(inArray(processed.messageId, [...deliveredMessageIds]));
    deliveredMessageIds.clear();
  }
}

async function seedRule(over: Partial<{
  id: string; keyword: string; matchType: string; channel: string | null;
  priority: number; responseBody: string | null; action: string | null; enabled: boolean;
}> = {}): Promise<string> {
  const id = over.id ?? RULE_ID;
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(keywordRules).values({
      id, tenantId: TENANT,
      keyword: over.keyword ?? "STOP",
      matchType: over.matchType ?? "exact",
      channel: over.channel ?? null,
      priority: over.priority ?? 100,
      // `??` would swallow an explicit null, which is exactly what the
      // action-only cases need to express.
      responseBody: over.responseBody === undefined ? "You have been unsubscribed." : over.responseBody,
      action: over.action ?? null,
      enabled: over.enabled ?? true,
      createdBy: ACTOR, updatedBy: ACTOR, version: 1,
    }).onConflictDoNothing();
  }));
  return id;
}

async function seedHandoff(state: string, agentId: string | null): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(conversationHandoffs).values({
      id: "ffff3333-1111-4000-8000-000000000033", tenantId: TENANT, conversationId: CONV,
      state, assignedAgentId: agentId, createdBy: ACTOR, updatedBy: ACTOR, version: 1,
    }).onConflictDoNothing();
  }));
}

async function deliver(topic: string, messageId: string, payload: unknown): Promise<MemoryQueue> {
  deliveredMessageIds.add(messageId);
  const q = new MemoryQueue();
  registerInboxConsumers(q);
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

/* ------------------------------------------------------- keyword rule routes */

describe("POST /v1/notification/inbox/keyword-rules", () => {
  it("202 for a rule with a reply body", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/inbox/keyword-rules", headers: bearer(["crm_admin"]),
      payload: { keyword: "STOP", matchType: "exact", channel: "sms", responseBody: "Unsubscribed." },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("202 for an action-only rule", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/inbox/keyword-rules", headers: bearer(["crm_admin"]),
      payload: { keyword: "AGENT", action: "escalate_to_human" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("422 for a rule that neither replies nor acts — a silent no-op", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/inbox/keyword-rules", headers: bearer(["crm_admin"]),
      payload: { keyword: "STOP" },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("EMPTY_RULE");
  });

  it("422 for a keyword with no matchable characters after normalisation", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/inbox/keyword-rules", headers: bearer(["crm_admin"]),
      payload: { keyword: "!!!", responseBody: "hi" },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("EMPTY_KEYWORD");
  });

  it("400 for a missing keyword", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/inbox/keyword-rules", headers: bearer(["crm_admin"]),
      payload: { responseBody: "hi" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for an unknown match type", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/inbox/keyword-rules", headers: bearer(["crm_admin"]),
      payload: { keyword: "STOP", matchType: "fuzzy", responseBody: "hi" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for an unknown channel", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/inbox/keyword-rules", headers: bearer(["crm_admin"]),
      payload: { keyword: "STOP", channel: "carrier_pigeon", responseBody: "hi" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for a priority above the maximum", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/inbox/keyword-rules", headers: bearer(["crm_admin"]),
      payload: { keyword: "STOP", priority: 99999, responseBody: "hi" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/inbox/keyword-rules",
      payload: { keyword: "STOP", responseBody: "hi" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a read-only role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/inbox/keyword-rules", headers: bearer(["audit_officer"]),
      payload: { keyword: "STOP", responseBody: "hi" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("403 for an unrelated role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/inbox/keyword-rules", headers: bearer(["citizen"]),
      payload: { keyword: "STOP", responseBody: "hi" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/notification/inbox/keyword-rules", () => {
  beforeAll(() => seedRule());

  it("200 with the list envelope", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/notification/inbox/keyword-rules?limit=20", headers: bearer(["crm_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().meta).toMatchObject({ page: 1, pageSize: 20 });
    expect((res.json().data as Array<{ id: string }>).some((r) => r.id === RULE_ID)).toBe(true);
  });

  it("200 for helpdesk_user (read role)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/notification/inbox/keyword-rules?limit=20", headers: bearer(["helpdesk_user"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("400 when limit is omitted", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/notification/inbox/keyword-rules", headers: bearer(["crm_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/notification/inbox/keyword-rules?limit=20" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for an unauthorised role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/notification/inbox/keyword-rules?limit=20", headers: bearer(["citizen"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("PATCH /v1/notification/inbox/keyword-rules/:id", () => {
  beforeEach(async () => { await cleanup(); await seedRule(); });

  it("202 for an existing rule", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH", url: `/v1/notification/inbox/keyword-rules/${RULE_ID}`,
      headers: bearer(["crm_admin"]), payload: { enabled: false },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("404 for an unknown rule", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH", url: `/v1/notification/inbox/keyword-rules/${UNKNOWN}`,
      headers: bearer(["crm_admin"]), payload: { enabled: false },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("400 for an empty patch body", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH", url: `/v1/notification/inbox/keyword-rules/${RULE_ID}`,
      headers: bearer(["crm_admin"]), payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for a non-uuid id", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH", url: "/v1/notification/inbox/keyword-rules/nope",
      headers: bearer(["crm_admin"]), payload: { enabled: false },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH", url: `/v1/notification/inbox/keyword-rules/${RULE_ID}`, payload: { enabled: false },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a read-only role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH", url: `/v1/notification/inbox/keyword-rules/${RULE_ID}`,
      headers: bearer(["audit_officer"]), payload: { enabled: false },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /v1/notification/inbox/keyword-match (dry run)", () => {
  beforeEach(async () => { await cleanup(); await seedRule({ channel: "sms", action: "opt_out" }); });

  it("200 reporting the winning rule and the plan", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/inbox/keyword-match", headers: bearer(["crm_admin"]),
      payload: { message: "  Stop! ", channel: "sms" },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.normalizedMessage).toBe("stop");
    expect(data.matchedRuleId).toBe(RULE_ID);
    expect(data.plan.kind).toBe("reply_and_action");
  });

  it("200 reporting no match on a different channel", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/inbox/keyword-match", headers: bearer(["crm_admin"]),
      payload: { message: "STOP", channel: "whatsapp" },
    });
    await app.close();
    expect(res.json().data.matchedRuleId).toBeNull();
    expect(res.json().data.plan).toEqual({ kind: "none" });
  });

  it("records nothing — a dry run must not write", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST", url: "/v1/notification/inbox/keyword-match", headers: bearer(["crm_admin"]),
      payload: { message: "STOP", channel: "sms" },
    });
    await app.close();
    const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(inboundAutoResponses).where(eq(inboundAutoResponses.tenantId, TENANT))));
    expect(rows).toHaveLength(0);
  });

  it("400 for a missing message", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/inbox/keyword-match", headers: bearer(["crm_admin"]),
      payload: { channel: "sms" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for an unknown channel", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/inbox/keyword-match", headers: bearer(["crm_admin"]),
      payload: { message: "STOP", channel: "telepathy" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/inbox/keyword-match", payload: { message: "STOP", channel: "sms" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for an unauthorised role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/inbox/keyword-match", headers: bearer(["citizen"]),
      payload: { message: "STOP", channel: "sms" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

/* ------------------------------------------------------------ handoff routes */

describe("POST /v1/notification/inbox/:conversationId/handoff", () => {
  beforeEach(cleanup);

  it("202 pausing an AI-handled conversation that has no handoff row yet", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/notification/inbox/${CONV}/handoff`,
      headers: bearer(["helpdesk_user"]), payload: { action: "pause", reason: "citizen asked for a human" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("202 assigning a human agent", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/notification/inbox/${CONV}/handoff`,
      headers: bearer(["helpdesk_admin"]), payload: { action: "assign_human", agentId: AGENT },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("422 for assign_human with no agentId — an unassigned handoff has no owner", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/notification/inbox/${CONV}/handoff`,
      headers: bearer(["helpdesk_admin"]), payload: { action: "assign_human" },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("AGENT_REQUIRED");
  });

  it("422 for resume_ai on a conversation the AI already owns", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/notification/inbox/${CONV}/handoff`,
      headers: bearer(["helpdesk_admin"]), payload: { action: "resume_ai" },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_TRANSITION");
  });

  it("422 for any action on a closed conversation", async () => {
    await seedHandoff("closed", null);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/notification/inbox/${CONV}/handoff`,
      headers: bearer(["helpdesk_admin"]), payload: { action: "resume_ai" },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
  });

  it("422 for pausing an already-paused conversation (hidden double submit)", async () => {
    await seedHandoff("paused", null);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/notification/inbox/${CONV}/handoff`,
      headers: bearer(["helpdesk_admin"]), payload: { action: "pause" },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
  });

  it("400 for an unknown action", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/notification/inbox/${CONV}/handoff`,
      headers: bearer(["helpdesk_admin"]), payload: { action: "escalate" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for a non-uuid agentId", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/notification/inbox/${CONV}/handoff`,
      headers: bearer(["helpdesk_admin"]), payload: { action: "assign_human", agentId: "nope" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for a non-uuid conversationId", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/inbox/nope/handoff",
      headers: bearer(["helpdesk_admin"]), payload: { action: "pause" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/notification/inbox/${CONV}/handoff`, payload: { action: "pause" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a read-only role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/notification/inbox/${CONV}/handoff`,
      headers: bearer(["audit_officer"]), payload: { action: "pause" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("403 for an unrelated role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/notification/inbox/${CONV}/handoff`,
      headers: bearer(["citizen"]), payload: { action: "pause" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/notification/inbox/:conversationId/handoff", () => {
  beforeEach(cleanup);

  it("200 reporting ai_handling for a conversation never handed off", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: `/v1/notification/inbox/${CONV}/handoff`, headers: bearer(["helpdesk_user"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.state).toBe("ai_handling");
    expect(data.aiPaused).toBe(false);
    expect(data.everHandedOff).toBe(false);
    expect(data.allowedActions).toEqual(["pause", "assign_human", "close"]);
    expect(data.auditTrail).toEqual([]);
  });

  it("200 reporting human_handling with the assigned agent", async () => {
    await seedHandoff("human_handling", AGENT);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: `/v1/notification/inbox/${CONV}/handoff`, headers: bearer(["helpdesk_user"]),
    });
    await app.close();
    const data = res.json().data;
    expect(data.state).toBe("human_handling");
    expect(data.assignedAgentId).toBe(AGENT);
    expect(data.aiPaused).toBe(true);
    expect(data.everHandedOff).toBe(true);
  });

  it("200 for audit_officer", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: `/v1/notification/inbox/${CONV}/handoff`, headers: bearer(["audit_officer"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("400 for a limit above the maximum", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: `/v1/notification/inbox/${CONV}/handoff?limit=900`, headers: bearer(["helpdesk_user"]),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for a non-uuid conversationId", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/notification/inbox/nope/handoff", headers: bearer(["helpdesk_user"]),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/notification/inbox/${CONV}/handoff` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for an unauthorised role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: `/v1/notification/inbox/${CONV}/handoff`, headers: bearer(["citizen"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

/* --------------------------------------------------------- keyword consumers */

describe("keyword rule consumer", () => {
  beforeEach(cleanup);

  async function rules() {
    return runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(keywordRules).where(eq(keywordRules.tenantId, TENANT))));
  }

  const createPayload = {
    id: RULE_ID, tenantId: TENANT, keyword: "STOP", matchType: "exact" as const,
    channel: "sms", priority: 10, responseBody: "Unsubscribed.",
  };

  it("creates the rule and emits created + audit", async () => {
    await deliver(COMMANDS.createKeywordRule, "ffff4444-1111-4000-8000-000000000401", createPayload);
    const rows = await rules();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ keyword: "STOP", matchType: "exact", channel: "sms", priority: 10, enabled: true });
    const outbox = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))));
    expect(outbox.map((m) => m.eventType)).toContain(EVENTS.keywordRuleCreated);
    expect(outbox.map((m) => m.eventType)).toContain("audit.event.record");
  });

  it("creating the same messageId twice writes one rule (idempotency)", async () => {
    const MSG = "ffff4444-1111-4000-8000-000000000402";
    await deliver(COMMANDS.createKeywordRule, MSG, createPayload);
    await deliver(COMMANDS.createKeywordRule, MSG, createPayload);
    expect(await rules()).toHaveLength(1);
  });

  it("dead-letters a blank keyword", async () => {
    const q = await deliver(COMMANDS.createKeywordRule, "ffff4444-1111-4000-8000-000000000403", {
      ...createPayload, keyword: "   ",
    });
    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toContain("keyword is required");
    expect(await rules()).toHaveLength(0);
  });

  it("updates a rule and bumps its version", async () => {
    await seedRule();
    await deliver(COMMANDS.updateKeywordRule, "ffff4444-1111-4000-8000-000000000404", {
      id: RULE_ID, tenantId: TENANT, enabled: false, priority: 5, matchType: "prefix",
    });
    const rows = await rules();
    expect(rows[0]).toMatchObject({ enabled: false, priority: 5, matchType: "prefix", version: 2 });
  });

  it("clears an optional field when the patch sends null", async () => {
    await seedRule({ action: "opt_out" });
    await deliver(COMMANDS.updateKeywordRule, "ffff4444-1111-4000-8000-000000000405", {
      id: RULE_ID, tenantId: TENANT, action: null,
    });
    expect((await rules())[0]?.action).toBeNull();
  });

  it("updating twice with the same messageId does not bump the version twice", async () => {
    await seedRule();
    const MSG = "ffff4444-1111-4000-8000-000000000406";
    await deliver(COMMANDS.updateKeywordRule, MSG, { id: RULE_ID, tenantId: TENANT, priority: 7 });
    const first = await rules();
    const q = await deliver(COMMANDS.updateKeywordRule, MSG, { id: RULE_ID, tenantId: TENANT, priority: 7 });
    const second = await rules();
    expect(second[0]?.version).toBe(first[0]?.version);
    expect(q.dlq).toHaveLength(0);
  });

  it("dead-letters an update for an unknown rule", async () => {
    const q = await deliver(COMMANDS.updateKeywordRule, "ffff4444-1111-4000-8000-000000000407", {
      id: UNKNOWN, tenantId: TENANT, enabled: false,
    });
    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toContain("KEYWORD_RULE_NOT_FOUND");
  });
});

describe("inbound message consumer — CR-MKT-06 auto-responses", () => {
  beforeEach(cleanup);

  async function responses() {
    return runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(inboundAutoResponses).where(eq(inboundAutoResponses.tenantId, TENANT))));
  }

  async function inbound(messageId: string, body: string, channel = "sms"): Promise<MemoryQueue> {
    return deliver(COMMANDS.inboundReceived, messageId, {
      id: messageId, tenantId: TENANT, channel, from: SENDER, body,
    });
  }

  it("records an auto-response and queues the reply through the shared send path", async () => {
    await seedRule({ keyword: "STOP", channel: "sms", responseBody: "You are unsubscribed." });
    const q = await inbound("ffff5555-1111-4000-8000-000000000501", "STOP");

    const rows = await responses();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe("reply");
    expect(rows[0]?.ruleId).toBe(RULE_ID);
    // PII: sender encrypted at rest, blind-indexed for lookups.
    expect(rows[0]?.sender).toBe(SENDER);
    expect(rows[0]?.senderHash).toBe(blindIndex(SENDER));
    // The reply goes out as a normal notification.send so consent/DND/suppression
    // still apply. Nothing was dead-lettered.
    expect(q.dlq).toHaveLength(0);

    const outbox = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(outboxMessages).where(and(
        eq(outboxMessages.tenantId, TENANT), eq(outboxMessages.eventType, EVENTS.keywordAutoResponded)))));
    expect(outbox).toHaveLength(1);
    // No PII in the emitted event.
    expect(JSON.stringify(outbox[0]?.payload)).not.toContain(SENDER);
  });

  it("processing the same inbound message twice records one auto-response (idempotency)", async () => {
    await seedRule({ keyword: "STOP", channel: "sms" });
    const MSG = "ffff5555-1111-4000-8000-000000000502";
    await inbound(MSG, "STOP");
    const first = await responses();
    await inbound(MSG, "STOP");
    const second = await responses();
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
  });

  it("records nothing when no rule matches", async () => {
    await seedRule({ keyword: "HELP", channel: "sms" });
    await inbound("ffff5555-1111-4000-8000-000000000503", "hello there");
    expect(await responses()).toHaveLength(0);
  });

  it("records an action-only outcome", async () => {
    await seedRule({ keyword: "AGENT", responseBody: null, action: "escalate_to_human" });
    await inbound("ffff5555-1111-4000-8000-000000000504", "agent");
    const rows = await responses();
    expect(rows[0]?.outcome).toBe("action");
    expect(rows[0]?.action).toBe("escalate_to_human");
  });

  it("records reply_and_action when the rule does both", async () => {
    await seedRule({ keyword: "STOP", responseBody: "Bye.", action: "opt_out" });
    await inbound("ffff5555-1111-4000-8000-000000000505", "stop");
    const rows = await responses();
    expect(rows[0]?.outcome).toBe("reply_and_action");
    expect(rows[0]?.action).toBe("opt_out");
  });

  it("records the outcome on a non-auto-reply channel but sends no reply", async () => {
    // web_chat is not in AUTO_REPLY_CHANNELS: the rule is still recorded, no SMS
    // goes out.
    await seedRule({ keyword: "STOP", channel: null, responseBody: "Bye." });
    const q = await inbound("ffff5555-1111-4000-8000-000000000506", "stop", "web_chat");
    const rows = await responses();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.channel).toBe("web_chat");
    expect(q.dlq).toHaveLength(0);
  });

  it("applies precedence — the channel-specific rule wins", async () => {
    await seedRule({ id: RULE_ID, keyword: "STOP", channel: null, responseBody: "generic" });
    const specific = await seedRule({
      id: "ffff1111-1111-4000-8000-000000000012", keyword: "STOP", channel: "sms", responseBody: "sms-specific",
    });
    await inbound("ffff5555-1111-4000-8000-000000000507", "STOP");
    expect((await responses())[0]?.ruleId).toBe(specific);
  });

  it("ignores a disabled rule", async () => {
    await seedRule({ keyword: "STOP", enabled: false });
    await inbound("ffff5555-1111-4000-8000-000000000508", "STOP");
    expect(await responses()).toHaveLength(0);
  });

  it("dead-letters a payload with no sender", async () => {
    const q = await deliver(COMMANDS.inboundReceived, "ffff5555-1111-4000-8000-000000000509", {
      id: "ffff5555-1111-4000-8000-000000000509", tenantId: TENANT, channel: "sms", body: "STOP",
    });
    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toContain("from and body are required");
  });

  it("dead-letters a payload with no body", async () => {
    const q = await deliver(COMMANDS.inboundReceived, "ffff5555-1111-4000-8000-000000000510", {
      id: "ffff5555-1111-4000-8000-000000000510", tenantId: TENANT, channel: "sms", from: SENDER,
    });
    expect(q.dlq).toHaveLength(1);
  });
});

describe("handoff transition consumer — F.5 state machine", () => {
  beforeEach(cleanup);

  async function state() {
    return runWithTenant(TENANT, () => db.transaction(async (tx) => ({
      handoffs: await tx.select().from(conversationHandoffs).where(eq(conversationHandoffs.tenantId, TENANT)),
      audit: await tx.select().from(handoffAudit).where(eq(handoffAudit.tenantId, TENANT)),
      outbox: await tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)),
    })));
  }

  function transition(messageId: string, over: Record<string, unknown>) {
    return deliver(COMMANDS.transitionHandoff, messageId, {
      id: messageId, tenantId: TENANT, conversationId: CONV, expectedFromState: "ai_handling", ...over,
    });
  }

  it("pauses a conversation, writes the audit row and emits aiPaused=true", async () => {
    await transition("ffff6666-1111-4000-8000-000000000601", { action: "pause", reason: "citizen asked" });
    const { handoffs, audit, outbox } = await state();
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0]?.state).toBe("paused");
    expect(handoffs[0]?.assignedAgentId).toBeNull();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ fromState: "ai_handling", toState: "paused", action: "pause", reason: "citizen asked" });
    const changed = outbox.find((m) => m.eventType === EVENTS.handoffStateChanged);
    expect((changed?.payload as { aiPaused?: boolean }).aiPaused).toBe(true);
  });

  it("assigns a human agent and records the owner", async () => {
    await transition("ffff6666-1111-4000-8000-000000000602", { action: "assign_human", agentId: AGENT });
    const { handoffs, audit } = await state();
    expect(handoffs[0]?.state).toBe("human_handling");
    expect(handoffs[0]?.assignedAgentId).toBe(AGENT);
    expect(audit[0]?.agentId).toBe(AGENT);
  });

  it("resume_ai clears the assigned agent and un-pauses the AI", async () => {
    await seedHandoff("human_handling", AGENT);
    await transition("ffff6666-1111-4000-8000-000000000603", {
      action: "resume_ai", expectedFromState: "human_handling",
    });
    const { handoffs, outbox } = await state();
    expect(handoffs[0]?.state).toBe("ai_handling");
    expect(handoffs[0]?.assignedAgentId).toBeNull();
    const changed = outbox.find((m) => m.eventType === EVENTS.handoffStateChanged);
    expect((changed?.payload as { aiPaused?: boolean }).aiPaused).toBe(false);
  });

  it("bumps the handoff row version on each accepted transition", async () => {
    await transition("ffff6666-1111-4000-8000-000000000604", { action: "pause" });
    const afterPause = await state();
    expect(afterPause.handoffs[0]?.version).toBe(1);
    await transition("ffff6666-1111-4000-8000-000000000605", {
      action: "resume_ai", expectedFromState: "paused",
    });
    const afterResume = await state();
    expect(afterResume.handoffs[0]?.version).toBe(2);
    expect(afterResume.audit).toHaveLength(2);
  });

  it("the same transition message twice writes one audit row (idempotency)", async () => {
    const MSG = "ffff6666-1111-4000-8000-000000000606";
    await transition(MSG, { action: "pause" });
    const first = await state();
    await transition(MSG, { action: "pause" });
    const second = await state();
    expect(second.audit).toHaveLength(1);
    expect(second.handoffs[0]?.version).toBe(first.handoffs[0]?.version);
  });

  it("rejects a transition whose expectedFromState is stale (concurrent change)", async () => {
    await seedHandoff("human_handling", AGENT);
    const q = await transition("ffff6666-1111-4000-8000-000000000607", {
      action: "pause", expectedFromState: "ai_handling",
    });
    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toContain("moved from");
    expect((await state()).audit).toHaveLength(0);
  });

  it("dead-letters an illegal transition from the recorded state", async () => {
    await seedHandoff("closed", null);
    const q = await transition("ffff6666-1111-4000-8000-000000000608", {
      action: "resume_ai", expectedFromState: "closed",
    });
    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toContain("INVALID_TRANSITION");
  });

  it("dead-letters an unknown action", async () => {
    const q = await transition("ffff6666-1111-4000-8000-000000000609", { action: "teleport" });
    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toContain("INVALID_HANDOFF_ACTION");
  });

  it("dead-letters assign_human with no agentId", async () => {
    const q = await transition("ffff6666-1111-4000-8000-000000000610", { action: "assign_human" });
    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toContain("agentId");
  });

  it("close is terminal and the audit trail records it", async () => {
    await transition("ffff6666-1111-4000-8000-000000000611", { action: "close", reason: "resolved" });
    const { handoffs, audit } = await state();
    expect(handoffs[0]?.state).toBe("closed");
    expect(audit[0]?.toState).toBe("closed");
  });

  it("a route read after a consumer transition reports the new state and trail", async () => {
    await transition("ffff6666-1111-4000-8000-000000000612", { action: "assign_human", agentId: AGENT });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: `/v1/notification/inbox/${CONV}/handoff`, headers: bearer(["helpdesk_user"]),
    });
    await app.close();
    const data = res.json().data;
    expect(data.state).toBe("human_handling");
    expect(data.aiPaused).toBe(true);
    expect(data.everHandedOff).toBe(true);
    expect(data.auditTrail).toHaveLength(1);
    expect(data.auditTrail[0].action).toBe("assign_human");
    expect(data.allowedActions).toEqual(["pause", "resume_ai", "close"]);
  });
});
