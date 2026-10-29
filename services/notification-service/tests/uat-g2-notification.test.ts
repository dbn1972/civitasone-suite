/**
 * UAT DB-test defects (g2 #10, #12, #13, #29, #30 and the webhook-secret security note).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { MemoryQueue, type Queue } from "@civitasone/queue";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { COMMANDS } from "../src/topics.js";
import { notificationTemplates } from "../src/modules/templates/schema.js";
import { registerTemplateConsumers } from "../src/modules/templates/consumer.js";
import { registerApprovalConsumers } from "../src/modules/approval/consumer.js";
import { registerInboxConsumers } from "../src/modules/inbox/consumer.js";
import { registerDigestConsumers } from "../src/modules/digest/consumer.js";
import { registerDndConsumers } from "../src/modules/dnd/consumer.js";
import { registerSegmentConsumers } from "../src/modules/segments/consumer.js";
import { registerWebhookConsumers } from "../src/modules/webhook/consumer.js";
import * as i18nRepo from "../src/modules/i18n/repo.js";
import { sendWithFallback } from "../src/modules/deliveries/channel.js";
import { crmInternalHeaders } from "../src/modules/deliveries/crm-consent-client.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const ACTOR = randomUUID();
const msgIds: string[] = [];

const bearer = (roles: string[]) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET, 3600)}`,
  "x-tenant-id": TENANT,
});

async function run(register: (q: Queue) => void, topic: string, payload: Record<string, unknown>) {
  const messageId = randomUUID();
  msgIds.push(messageId);
  const q = new MemoryQueue();
  register(q);
  await q.start();
  await q.publish(topic, {
    messageId, type: topic, tenantId: TENANT, actorId: ACTOR,
    correlationId: `c-${messageId}`, schemaVersion: "1.0", payload,
  });
  await q.drain();
  await q.stop();
}

const inTenant = <T>(fn: (tx: typeof db) => Promise<T>) =>
  runWithTenant(TENANT, () => db.transaction((tx) => fn(tx as unknown as typeof db)));

async function version(table: string, id: string): Promise<number | undefined> {
  const rows = await inTenant((tx) => tx.execute(sql.raw(`SELECT version FROM ${table} WHERE id = '${id}'`)));
  return (rows as unknown as Array<{ version: number }>)[0]?.version;
}

beforeAll(() => { process.env.INTERNAL_SERVICE_SECRET = `${randomUUID()}${randomUUID()}`; });

afterAll(async () => {
  await inTenant(async (tx) => {
    await tx.delete(notificationTemplates).where(eq(notificationTemplates.tenantId, TENANT));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    for (const t of ["digest.digest_rules", "dnd.dnd_windows", "segments.recipient_segments", "webhook.endpoints", "notification.inbound_review_queue"]) {
      await tx.execute(sql.raw(`DELETE FROM ${t} WHERE tenant_id = '${TENANT}'`)).catch(() => {});
    }
  }).catch(() => {});
  for (const id of msgIds) await db.delete(processed).where(eq(processed.messageId, id)).catch(() => {});
  await sqlClient.end();
});

describe("UAT #10 — template update", () => {
  it("applies: new version created, previous version retired as 'archived' (chk_template_status-safe)", async () => {
    const v1 = randomUUID(); const v2 = randomUUID();
    await run(registerTemplateConsumers, COMMANDS.createTemplate, { id: v1, tenantId: TENANT, channel: "email", name: "t", subject: "s", body: "b1" });
    await run(registerTemplateConsumers, COMMANDS.updateTemplate, { id: v2, tenantId: TENANT, templateId: v1, body: "b2" });
    const rows = await inTenant((tx) => tx.select().from(notificationTemplates).where(eq(notificationTemplates.tenantId, TENANT)));
    const old = rows.find((r) => r.id === v1);
    const next = rows.find((r) => r.id === v2);
    expect(old?.status).toBe("archived");
    expect(old?.supersededBy).toBe(v2);
    expect(next?.version).toBe(2);
    expect(next?.body).toBe("b2");
  });
});

describe("UAT #13 — template approval is reachable", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const T = randomUUID();
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });

  it("new templates start as 'draft'", async () => {
    await run(registerTemplateConsumers, COMMANDS.createTemplate, { id: T, tenantId: TENANT, channel: "email", name: "appr", subject: "s", body: "b" });
    const [row] = await inTenant((tx) => tx.select().from(notificationTemplates).where(eq(notificationTemplates.id, T)));
    expect(row?.status).toBe("draft");
  });

  it("submit with no body returns 400, not 500", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/templates/${T}/submit`,
      headers: { ...bearer(["tenant_admin"]), "content-type": "application/json" }, payload: "",
    });
    expect(res.statusCode).toBe(400);
  });

  it("submit moves draft -> in_review", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/templates/${T}/submit`,
      headers: { ...bearer(["tenant_admin"]), "content-type": "application/json" }, payload: {},
    });
    expect(res.statusCode).toBe(202);
    await run(registerApprovalConsumers, COMMANDS.submitTemplate, { templateId: T, tenantId: TENANT, submittedBy: ACTOR });
    const [row] = await inTenant((tx) => tx.select().from(notificationTemplates).where(eq(notificationTemplates.id, T)));
    expect(row?.status).toBe("in_review");
  });
});

describe("UAT #12 — inbound CRM lookup authenticates with the full internal header set", () => {
  it("sends x-service-secret + x-internal-caller and queues an unmatched sender for review", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    try {
      await run(registerInboxConsumers, COMMANDS.inboundReceived, {
        id: randomUUID(), tenantId: TENANT, channel: "sms", from: "+919800000012", body: "hello",
      });
      const call = fetchSpy.mock.calls.find((c) => String(c[0]).includes("/v1/crm/contacts?phone="));
      expect(call).toBeDefined();
      const headers = (call![1] as RequestInit).headers as Record<string, string>;
      expect(headers["x-internal"]).toBe("1");
      expect(headers["x-service-secret"]).toBe(process.env.INTERNAL_SERVICE_SECRET);
      expect(headers["x-internal-caller"]).toBe("notification-service");
      expect(headers["x-tenant-id"]).toBe(TENANT);
      const rows = await inTenant((tx) => tx.execute(sql`SELECT 1 FROM notification.inbound_review_queue WHERE tenant_id = ${TENANT}`));
      expect((rows as unknown as unknown[]).length).toBe(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("crmInternalHeaders is null (no blind call) when the shared secret is unset", () => {
    const saved = process.env.INTERNAL_SERVICE_SECRET;
    delete process.env.INTERNAL_SERVICE_SECRET;
    try { expect(crmInternalHeaders(TENANT, "c")).toBeNull(); } finally { process.env.INTERNAL_SERVICE_SECRET = saved; }
  });
});

describe("SECURITY — webhook signing secret is masked on every read", () => {
  it("GET /v1/webhooks never returns the stored secret", async () => {
    const id = randomUUID();
    const plain = `${randomUUID()}${randomUUID()}`;
    await run(registerWebhookConsumers, COMMANDS.createWebhookEndpoint, { id, tenantId: TENANT, name: "hook", url: "https://example.gov.in/hook", secret: plain });
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: "/v1/webhooks", headers: bearer(["tenant_admin"]) });
      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain(plain);
      const row = res.json().data.find((e: { id: string }) => e.id === id);
      expect(row.secret).toBe("********");
    } finally { await app.close(); }
  });
});

describe("UAT #29 — notification updates bump version", () => {
  it("digest rule, dnd window, webhook endpoint, segment and locale variant", async () => {
    const dr = randomUUID(), dnd = randomUUID(), wh = randomUUID(), seg = randomUUID(), lv = randomUUID(), tpl = randomUUID();
    await run(registerDigestConsumers, COMMANDS.createDigestRule, { id: dr, tenantId: TENANT, eventType: "e.x", channel: "email", accumulationWindowMinutes: 30, digestTemplateId: tpl });
    await run(registerDigestConsumers, COMMANDS.updateDigestRule, { id: dr, tenantId: TENANT, enabled: false });
    expect(await version("digest.digest_rules", dr)).toBe(2);

    await run(registerDndConsumers, COMMANDS.setDndWindow, { id: dnd, tenantId: TENANT, userId: ACTOR, startTime: "22:00", endTime: "06:00", timezone: "Asia/Kolkata" });
    await run(registerDndConsumers, COMMANDS.updateDndWindow, { id: dnd, tenantId: TENANT, enabled: false });
    expect(await version("dnd.dnd_windows", dnd)).toBe(2);

    await run(registerWebhookConsumers, COMMANDS.createWebhookEndpoint, { id: wh, tenantId: TENANT, name: "h2", url: "https://example.gov.in/h2", secret: `${randomUUID()}${randomUUID()}` });
    await run(registerWebhookConsumers, COMMANDS.updateWebhookEndpoint, { id: wh, tenantId: TENANT, enabled: false });
    expect(await version("webhook.endpoints", wh)).toBe(2);

    await run(registerSegmentConsumers, COMMANDS.createSegment, { id: seg, tenantId: TENANT, name: "s", criteria: { roles: ["citizen"] } });
    await run(registerSegmentConsumers, COMMANDS.updateSegment, { id: seg, tenantId: TENANT, name: "s2" });
    expect(await version("segments.recipient_segments", seg)).toBe(2);

    await inTenant(async (tx) => {
      await i18nRepo.insertVariant(tx, { id: lv, tenantId: TENANT, templateId: tpl, locale: "hi", body: "b", status: "current", createdBy: ACTOR, updatedBy: ACTOR, version: 1 });
      await i18nRepo.updateVariant(tx, lv, TENANT, { body: "b2", updatedBy: ACTOR });
    });
    expect(await version("i18n.locale_variants", lv)).toBe(2);
  });
});

describe("UAT #30 — push send with no provider configured (by design)", () => {
  it("the push adapter refuses (NOT_CONFIGURED) and delivery falls back to email, so no channel=push row is written", async () => {
    const r = await sendWithFallback(["push", "email"], { recipient: "dev-token", subject: "s", body: "b", tenantId: TENANT, userId: ACTOR });
    expect(r.error).toBeUndefined();
    expect(r.channel).toBe("email");
    const push = await sendWithFallback(["push"], { recipient: "dev-token", subject: "s", body: "b", tenantId: TENANT, userId: ACTOR });
    expect(push.error).toMatch(/Push not configured/);
  });
});
