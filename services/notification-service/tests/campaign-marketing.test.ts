/**
 * BRD §7.9 Campaign & Source Management (MK-001, MK-004) — marketing extension.
 *
 * Covers, against a live Postgres with FORCED RLS:
 *  - create-with-budget PERSISTS: HTTP → queue → real bulk consumer → committed
 *    row (asserts the row lands with the right bigint-paise budget, not just 202).
 *  - GET /notifications/campaigns pagination + tenant scoping.
 *  - GET /notifications/campaigns/:id/metrics ROI math: cost=0 → null roiBps, and
 *    an exact positive-ROI basis-point case with pure integer arithmetic.
 *  - POST /notifications/campaigns/:id/responses upsert — the same subject twice
 *    does not double-count.
 *  - RLS cross-tenant isolation: tenant B cannot see tenant A's campaign, list,
 *    metrics, or attribute a response to it.
 *
 * The consumer is driven exactly as complaints.test.ts drives it: a fresh
 * MemoryQueue with the REAL registerBulkConsumers, publish, drain, then read the
 * committed rows back under the tenant GUC.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import {
  notificationCampaigns,
  notificationCampaignRecipients,
  notificationCampaignResponses,
} from "../src/modules/bulk/schema.js";
import { recipientSegments } from "../src/modules/segments/schema.js";
import { registerBulkConsumers } from "../src/modules/bulk/consumer.js";
import {
  registerDeliveryConsumers,
  setConsentLookupForTests,
  resetConsentLookup,
} from "../src/modules/deliveries/consumer.js";
import { emailAdapter } from "../src/adapters/index.js";
import { computeRoiBps } from "../src/modules/bulk/domain.js";
import { COMMANDS } from "../src/topics.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET as string;

/** This file owns two tenants so parallel suites cannot collide on fixtures. */
const TENANT_A = "aaaa0079-9999-4000-8000-000000000001";
const TENANT_B = "bbbb0079-9999-4000-8000-000000000002";
const ACTOR_A = "aaaa0079-9999-4000-8000-0000000000aa";
const ACTOR_B = "bbbb0079-9999-4000-8000-0000000000bb";
const SYSTEM = "00000000-0000-0000-0000-000000000001";

function token(tid: string, actor: string, roles: string[] = ["tenant_admin"]): string {
  return signToken({ sub: actor, tid, roles, sid: "sess-mk" }, SECRET, 3600);
}
const bearerA = (roles?: string[]) => ({ authorization: `Bearer ${token(TENANT_A, ACTOR_A, roles)}`, "content-type": "application/json" });
const bearerB = (roles?: string[]) => ({ authorization: `Bearer ${token(TENANT_B, ACTOR_B, roles)}`, "content-type": "application/json" });

/** Message ids delivered by this file, so cleanup can scope its processed reset. */
const deliveredMessageIds = new Set<string>();

/**
 * Domain tables have FORCED RLS and the service role is NOBYPASSRLS (#146), so
 * raw seeding/inspection must set the app.tenant_id GUC. Transaction-LOCAL.
 */
async function sqlAsTenant<T>(tenantId: string, fn: (sql: typeof sqlClient) => Promise<T> | T): Promise<T> {
  return sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(sql as unknown as typeof sqlClient);
  }) as Promise<T>;
}

/** A real template row so the campaign send path can resolve a channel. */
async function seedTemplate(tenantId: string, templateId: string): Promise<void> {
  await sqlAsTenant(tenantId, (sql) => sql`
    INSERT INTO templates.templates (id, tenant_id, channel, name, subject, body, created_by, updated_by)
    VALUES (${templateId}, ${tenantId}, 'email', 'MK Send', 'Subject', 'Body', ${SYSTEM}, ${SYSTEM})
    ON CONFLICT (id) DO UPDATE SET channel = 'email'`);
}

async function cleanup(): Promise<void> {
  for (const t of [TENANT_A, TENANT_B]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(notificationCampaignResponses).where(eq(notificationCampaignResponses.tenantId, t));
      await tx.delete(notificationCampaignRecipients).where(eq(notificationCampaignRecipients.tenantId, t));
      await tx.delete(notificationCampaigns).where(eq(notificationCampaigns.tenantId, t));
      await tx.delete(recipientSegments).where(eq(recipientSegments.tenantId, t));
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
    }));
    await sqlAsTenant(t, async (sql) => {
      await sql`DELETE FROM deliveries.deliveries WHERE tenant_id = ${t}`;
      await sql`DELETE FROM templates.templates WHERE tenant_id = ${t}`;
    });
  }
  if (deliveredMessageIds.size > 0) {
    const { inArray } = await import("drizzle-orm");
    await db.delete(processed).where(inArray(processed.messageId, [...deliveredMessageIds]));
    deliveredMessageIds.clear();
  }
}

/**
 * Drive the REAL deliveries consumer for one campaign recipient — the same
 * command shape bulk/consumer.ts fans out (campaignId + recipientId + marketing
 * category). retryCount=MAX (3) forces a terminal 'failed' when the adapter
 * errors, instead of a durable retry.
 */
async function sendCampaignRecipient(
  tenantId: string, templateId: string, campaignId: string, recipient: string, retryCount = 0,
): Promise<void> {
  const messageId = randomUUID();
  deliveredMessageIds.add(messageId);
  const q = new MemoryQueue();
  registerDeliveryConsumers(q);
  await q.start();
  await q.publish(COMMANDS.sendNotification, {
    messageId, type: COMMANDS.sendNotification, tenantId, actorId: SYSTEM,
    correlationId: "corr-mk-send", schemaVersion: "1.0",
    payload: {
      templateId, recipientId: recipient, recipient, tenantId,
      variables: {}, campaignId, category: "marketing", retryCount,
    },
  });
  await q.drain();
  await q.stop();
}

/** Drive the REAL create consumer end-to-end (HTTP-equivalent command → DB row). */
async function createCampaignViaConsumer(
  tenantId: string, actorId: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const messageId = randomUUID();
  deliveredMessageIds.add(messageId);
  const q = new MemoryQueue();
  registerBulkConsumers(q);
  await q.start();
  await q.publish(COMMANDS.createCampaign, {
    messageId, type: COMMANDS.createCampaign, tenantId, actorId,
    correlationId: "corr-mk", schemaVersion: "1.0", payload,
  });
  await q.drain();
  await q.stop();
  return payload.id as string;
}

async function campaignRow(tenantId: string, id: string): Promise<Record<string, unknown> | undefined> {
  return runWithTenant(tenantId, () => db.transaction(async (tx) => {
    const rows = await tx.select().from(notificationCampaigns).where(eq(notificationCampaigns.id, id)).limit(1);
    return rows[0] as unknown as Record<string, unknown> | undefined;
  })) as Promise<Record<string, unknown> | undefined>;
}

/** Set actual_cost_minor directly (realised cost is set post-send in production). */
async function setActualCost(tenantId: string, id: string, costMinor: string): Promise<void> {
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.update(notificationCampaigns)
      .set({ actualCostMinor: BigInt(costMinor) })
      .where(eq(notificationCampaigns.id, id));
  }));
}

let app: FastifyInstance;

beforeAll(async () => {
  await cleanup();
  app = await buildApp();
});
beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

describe("computeRoiBps — pure integer BigInt arithmetic", () => {
  it("returns null when actual cost is 0 (no div-by-zero)", () => {
    expect(computeRoiBps(500000n, 0n)).toBeNull();
  });

  it("100% ROI = 10000 bps (revenue 2x cost)", () => {
    // ((200000 - 100000) / 100000) * 10000 = 10000
    expect(computeRoiBps(200000n, 100000n)).toBe(10000);
  });

  it("exact bps with truncation — revenue 150000, cost 100000 → 5000 bps", () => {
    // ((150000 - 100000) * 10000) / 100000 = 5000
    expect(computeRoiBps(150000n, 100000n)).toBe(5000);
  });

  it("a loss yields negative bps", () => {
    // ((40000 - 100000) * 10000) / 100000 = -6000
    expect(computeRoiBps(40000n, 100000n)).toBe(-6000);
  });
});

describe("MK-001 create-with-budget persists (HTTP boundary + consumer round-trip)", () => {
  it("POST /notifications/campaigns accepts marketing fields → 202", async () => {
    const res = await app.inject({
      method: "POST", url: "/notifications/campaigns", headers: bearerA(),
      payload: {
        templateId: randomUUID(), name: "Diwali Outreach", recipients: ["a@dept.gov.in"],
        objective: "Awareness", budgetMinor: 5000000, currency: "INR", audienceSegmentId: randomUUID(),
      },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toHaveProperty("id");
  });

  it("accepts budgetMinor as a numeric STRING (bigint paise, no float)", async () => {
    const res = await app.inject({
      method: "POST", url: "/notifications/campaigns", headers: bearerA(),
      payload: { templateId: randomUUID(), name: "x", recipients: ["a@dept.gov.in"], budgetMinor: "999999999999" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("the real consumer commits the campaign with the exact bigint budget", async () => {
    const id = randomUUID();
    await createCampaignViaConsumer(TENANT_A, ACTOR_A, {
      id, tenantId: TENANT_A, templateId: randomUUID(), name: "Persisted Campaign",
      recipients: ["r1@dept.gov.in", "r2@dept.gov.in"],
      objective: "Lead-gen", budgetMinor: "12345678901234", currency: "INR",
      audienceSegmentId: randomUUID(),
    });
    const row = await campaignRow(TENANT_A, id);
    expect(row).toBeDefined();
    expect(row?.name).toBe("Persisted Campaign");
    expect(row?.objective).toBe("Lead-gen");
    // bigint mode → JS bigint back from drizzle; the value must be exact.
    expect(row?.budgetMinor).toBe(12345678901234n);
    expect(row?.currency).toBe("INR");
    expect(row?.actualCostMinor).toBe(0n);
  });
});

describe("MK-001 GET /notifications/campaigns — pagination + tenant scoping", () => {
  it("lists a tenant's campaigns with total, respecting limit/offset", async () => {
    for (let i = 0; i < 3; i++) {
      await createCampaignViaConsumer(TENANT_A, ACTOR_A, {
        id: randomUUID(), tenantId: TENANT_A, templateId: randomUUID(),
        name: `List Campaign ${i}`, recipients: ["a@dept.gov.in"], budgetMinor: String(i * 1000),
        currency: "INR",
      });
    }
    const page1 = await app.inject({ method: "GET", url: "/notifications/campaigns?limit=2&offset=0", headers: bearerA() });
    expect(page1.statusCode).toBe(200);
    const b1 = page1.json();
    expect(b1.total).toBe(3);
    expect(b1.campaigns).toHaveLength(2);
    // budgetMinor is string-encoded (bigint paise convention).
    expect(typeof b1.campaigns[0].budgetMinor).toBe("string");

    const page2 = await app.inject({ method: "GET", url: "/notifications/campaigns?limit=2&offset=2", headers: bearerA() });
    expect(page2.json().campaigns).toHaveLength(1);
  });

  it("tenant B's list does NOT include tenant A's campaigns", async () => {
    await createCampaignViaConsumer(TENANT_A, ACTOR_A, {
      id: randomUUID(), tenantId: TENANT_A, templateId: randomUUID(),
      name: "Tenant-A-only", recipients: ["a@dept.gov.in"], budgetMinor: "1", currency: "INR",
    });
    const res = await app.inject({ method: "GET", url: "/notifications/campaigns", headers: bearerB() });
    expect(res.statusCode).toBe(200);
    const names = res.json().campaigns.map((c: { name: string }) => c.name);
    expect(names).not.toContain("Tenant-A-only");
  });
});

describe("MK-004 GET /notifications/campaigns/:id/metrics — server-side ROI", () => {
  it("cost=0 → roiBps null; recipients counted from campaign_recipients", async () => {
    const id = randomUUID();
    await createCampaignViaConsumer(TENANT_A, ACTOR_A, {
      id, tenantId: TENANT_A, templateId: randomUUID(), name: "Metrics zero-cost",
      recipients: ["a@dept.gov.in", "b@dept.gov.in"], budgetMinor: "100000", currency: "INR",
    });
    const res = await app.inject({ method: "GET", url: `/notifications/campaigns/${id}/metrics`, headers: bearerA() });
    expect(res.statusCode).toBe(200);
    const m = res.json();
    expect(m.recipients).toBe(2);
    expect(m.responses).toBe(0);
    expect(m.conversions).toBe(0);
    expect(m.attributedRevenueMinor).toBe("0");
    expect(m.actualCostMinor).toBe("0");
    expect(m.roiBps).toBeNull();
  });

  it("positive ROI computed exactly from responses (integer bps)", async () => {
    const id = randomUUID();
    await createCampaignViaConsumer(TENANT_A, ACTOR_A, {
      id, tenantId: TENANT_A, templateId: randomUUID(), name: "Metrics ROI",
      recipients: ["a@dept.gov.in"], budgetMinor: "100000", currency: "INR",
    });
    await setActualCost(TENANT_A, id, "100000");
    // Two responses, one converted, total attributed revenue = 150000 paise.
    await app.inject({
      method: "POST", url: `/notifications/campaigns/${id}/responses`, headers: bearerA(),
      payload: { subjectType: "lead", subjectId: randomUUID(), converted: true, revenueMinor: "90000" },
    });
    await app.inject({
      method: "POST", url: `/notifications/campaigns/${id}/responses`, headers: bearerA(),
      payload: { subjectType: "contact", subjectId: randomUUID(), converted: false, revenueMinor: "60000" },
    });
    const res = await app.inject({ method: "GET", url: `/notifications/campaigns/${id}/metrics`, headers: bearerA() });
    const m = res.json();
    expect(m.responses).toBe(2);
    expect(m.conversions).toBe(1);
    expect(m.attributedRevenueMinor).toBe("150000");
    expect(m.actualCostMinor).toBe("100000");
    // ((150000 - 100000) * 10000) / 100000 = 5000 bps
    expect(m.roiBps).toBe(5000);
  });

  it("404 for a campaign that does not exist in this tenant", async () => {
    const res = await app.inject({ method: "GET", url: `/notifications/campaigns/${randomUUID()}/metrics`, headers: bearerA() });
    expect(res.statusCode).toBe(404);
  });
});

describe("MK-004 POST /notifications/campaigns/:id/responses — upsert", () => {
  it("the same subject recorded twice does NOT double-count", async () => {
    const id = randomUUID();
    await createCampaignViaConsumer(TENANT_A, ACTOR_A, {
      id, tenantId: TENANT_A, templateId: randomUUID(), name: "Upsert Campaign",
      recipients: ["a@dept.gov.in"], budgetMinor: "0", currency: "INR",
    });
    const subjectId = randomUUID();
    const first = await app.inject({
      method: "POST", url: `/notifications/campaigns/${id}/responses`, headers: bearerA(),
      payload: { subjectType: "lead", subjectId, revenueMinor: "10000" },
    });
    expect(first.statusCode).toBe(200);
    // Second record for the SAME subject: converts + revises revenue.
    const second = await app.inject({
      method: "POST", url: `/notifications/campaigns/${id}/responses`, headers: bearerA(),
      payload: { subjectType: "lead", subjectId, converted: true, revenueMinor: "25000" },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id); // same row, upserted

    const metrics = (await app.inject({ method: "GET", url: `/notifications/campaigns/${id}/metrics`, headers: bearerA() })).json();
    expect(metrics.responses).toBe(1);       // NOT 2 — deduped
    expect(metrics.conversions).toBe(1);
    expect(metrics.attributedRevenueMinor).toBe("25000"); // updated, not summed to 35000
  });

  it("403 for a non-admin role, 404 for an unknown campaign", async () => {
    const forbidden = await app.inject({
      method: "POST", url: `/notifications/campaigns/${randomUUID()}/responses`, headers: bearerA(["citizen"]),
      payload: { subjectType: "lead", subjectId: randomUUID() },
    });
    expect(forbidden.statusCode).toBe(403);

    const notFound = await app.inject({
      method: "POST", url: `/notifications/campaigns/${randomUUID()}/responses`, headers: bearerA(),
      payload: { subjectType: "lead", subjectId: randomUUID() },
    });
    expect(notFound.statusCode).toBe(404);
  });
});

describe("MK RLS cross-tenant isolation", () => {
  it("tenant B cannot read, see metrics of, or attribute a response to tenant A's campaign", async () => {
    const id = randomUUID();
    await createCampaignViaConsumer(TENANT_A, ACTOR_A, {
      id, tenantId: TENANT_A, templateId: randomUUID(), name: "Secret Campaign A",
      recipients: ["a@dept.gov.in"], budgetMinor: "777", currency: "INR",
    });

    // GET :id — tenant B sees 404 (RLS-scoped, not 403).
    const getB = await app.inject({ method: "GET", url: `/notifications/campaigns/${id}`, headers: bearerB() });
    expect(getB.statusCode).toBe(404);

    // Metrics — 404 for tenant B.
    const metricsB = await app.inject({ method: "GET", url: `/notifications/campaigns/${id}/metrics`, headers: bearerB() });
    expect(metricsB.statusCode).toBe(404);

    // Response attribution — tenant B cannot attach to tenant A's campaign (404).
    const respB = await app.inject({
      method: "POST", url: `/notifications/campaigns/${id}/responses`, headers: bearerB(),
      payload: { subjectType: "lead", subjectId: randomUUID(), revenueMinor: "500" },
    });
    expect(respB.statusCode).toBe(404);

    // And tenant A still sees it (control).
    const getA = await app.inject({ method: "GET", url: `/notifications/campaigns/${id}`, headers: bearerA() });
    expect(getA.statusCode).toBe(200);
    expect(getA.json().budgetMinor).toBe("777");
  });
});

describe("MK-004 metrics reflect REAL delivery outcomes (deliveries → campaign_recipients)", () => {
  it("a delivered and a failed campaign recipient yield delivered:1, failed:1 (not frozen 0s)", async () => {
    const templateId = randomUUID();
    await seedTemplate(TENANT_A, templateId);
    const id = randomUUID();
    // The campaign fan-out carries the recipient identifier as recipientId, which
    // lands in deliveries.recipient_id (a uuid column) — so the recipient key is a
    // uuid, exactly as the real send path and consent-gate tests use.
    const deliverTo = randomUUID();
    const failTo = randomUUID();
    await createCampaignViaConsumer(TENANT_A, ACTOR_A, {
      id, tenantId: TENANT_A, templateId, name: "Outcome Campaign",
      recipients: [deliverTo, failTo], budgetMinor: "0", currency: "INR",
    });

    setConsentLookupForTests(async () => "granted");
    const spy = vi.spyOn(emailAdapter, "send");
    try {
      // Recipient 1: adapter succeeds → delivery 'delivered' → recipient 'delivered'.
      spy.mockResolvedValue({ ok: true });
      await sendCampaignRecipient(TENANT_A, templateId, id, deliverTo, 0);
      // Recipient 2: adapter errors at max retryCount → terminal 'failed'.
      spy.mockResolvedValue({ ok: false, error: "smtp down" });
      await sendCampaignRecipient(TENANT_A, templateId, id, failTo, 3);
    } finally {
      spy.mockRestore();
      resetConsentLookup();
    }

    // The campaign_recipients rows now carry REAL outcomes, not a frozen 'queued'.
    const statuses = await runWithTenant(TENANT_A, () => db.transaction(async (tx) => {
      const rows = await tx.select().from(notificationCampaignRecipients)
        .where(eq(notificationCampaignRecipients.campaignId, id));
      return rows.map((r) => r.status).sort();
    }));
    expect(statuses).toEqual(["delivered", "failed"]);

    const m = (await app.inject({ method: "GET", url: `/notifications/campaigns/${id}/metrics`, headers: bearerA() })).json();
    expect(m.recipients).toBe(2);
    expect(m.delivered).toBe(1);
    expect(m.failed).toBe(1);
  });
});

describe("MK-001 create consumer hardening — malformed budget must not wedge the queue", () => {
  it("a non-digit budget is marked processed (no poison loop) and creates no campaign", async () => {
    const id = randomUUID();
    const messageId = randomUUID();
    deliveredMessageIds.add(messageId);
    const q = new MemoryQueue();
    registerBulkConsumers(q);
    await q.start();
    await q.publish(COMMANDS.createCampaign, {
      messageId, type: COMMANDS.createCampaign, tenantId: TENANT_A, actorId: ACTOR_A,
      correlationId: "corr-bad-budget", schemaVersion: "1.0",
      payload: {
        id, tenantId: TENANT_A, templateId: randomUUID(), name: "Bad Budget",
        recipients: ["a@dept.gov.in"], budgetMinor: "not-a-number", currency: "INR",
      },
    });
    await q.drain();
    await q.stop();

    // No poison: the malformed message neither threw nor dead-lettered.
    expect(q.dlq).toHaveLength(0);
    // Marked processed (committed) — a redelivery would be a no-op, not a retry storm.
    const proc = await db.select().from(processed).where(eq(processed.messageId, messageId));
    expect(proc).toHaveLength(1);
    // No campaign row was created for the bad input.
    expect(await campaignRow(TENANT_A, id)).toBeUndefined();
  });

  it("a negative budget is rejected the same way (CHECK-constraint safe)", async () => {
    const id = randomUUID();
    const messageId = randomUUID();
    deliveredMessageIds.add(messageId);
    const q = new MemoryQueue();
    registerBulkConsumers(q);
    await q.start();
    await q.publish(COMMANDS.createCampaign, {
      messageId, type: COMMANDS.createCampaign, tenantId: TENANT_A, actorId: ACTOR_A,
      correlationId: "corr-neg-budget", schemaVersion: "1.0",
      payload: {
        id, tenantId: TENANT_A, templateId: randomUUID(), name: "Neg Budget",
        recipients: ["a@dept.gov.in"], budgetMinor: "-100", currency: "INR",
      },
    });
    await q.drain();
    await q.stop();
    expect(q.dlq).toHaveLength(0);
    expect(await campaignRow(TENANT_A, id)).toBeUndefined();
  });
});

describe("MK integration — GET /notifications/segments gateway alias", () => {
  it("returns the tenant's segments and hides other tenants'", async () => {
    const segId = randomUUID();
    await sqlAsTenant(TENANT_A, (sql) => sql`
      INSERT INTO segments.recipient_segments (id, tenant_id, name, criteria, created_by, updated_by)
      VALUES (${segId}, ${TENANT_A}, 'VIP Leads', ${sql.json({ roles: ["citizen"] })}, ${SYSTEM}, ${SYSTEM})`);

    const a = await app.inject({ method: "GET", url: "/notifications/segments", headers: bearerA() });
    expect(a.statusCode).toBe(200);
    const body = a.json();
    expect(Array.isArray(body.segments)).toBe(true);
    expect(body.segments.map((s: { id: string }) => s.id)).toContain(segId);
    expect(body.total).toBe(body.segments.length);

    // Tenant B must not see tenant A's segment (RLS-scoped list).
    const b = await app.inject({ method: "GET", url: "/notifications/segments", headers: bearerB() });
    expect(b.statusCode).toBe(200);
    expect(b.json().segments.map((s: { id: string }) => s.id)).not.toContain(segId);
  });

  it("401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: "/notifications/segments" });
    expect(res.statusCode).toBe(401);
  });
});
