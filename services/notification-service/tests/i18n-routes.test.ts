/**
 * Pack #17 — I18N: Route tests + consumer integration.
 *
 * Tests locale CRUD routes (RBAC, validation, 409 duplicate, BCP47 enforcement),
 * consumer idempotency, audit emission, and the stale-flagging on base update.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq, and, inArray } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { localeVariants } from "../src/modules/i18n/schema.js";
import { registerI18nConsumers, flagVariantsOnBaseUpdate } from "../src/modules/i18n/consumer.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "eeee0001-1111-4000-8000-000000118a01";
const ACTOR = "eeeeaaaa-1111-4000-8000-000000118a0a";
const TEMPLATE_ID = "eeee1111-1111-4000-8000-0000000e0101";
const VARIANT_ID = "eeee2222-1111-4000-8000-000000ba1001";

function token(roles: string[], tid = TENANT): string {
  return signToken({ sub: ACTOR, tid, roles, sid: "sess-i18n" }, SECRET, 3600);
}
const bearer = (roles: string[], tid = TENANT) => ({ authorization: `Bearer ${token(roles, tid)}` });

const deliveredMessageIds = new Set<string>();

async function cleanup(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(localeVariants).where(eq(localeVariants.tenantId, TENANT));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
  }));
  if (deliveredMessageIds.size > 0) {
    await db.delete(processed).where(inArray(processed.messageId, [...deliveredMessageIds]));
    deliveredMessageIds.clear();
  }
}

async function seedVariant(locale = "hi-IN", status = "current"): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(localeVariants).values({
      id: VARIANT_ID,
      tenantId: TENANT,
      templateId: TEMPLATE_ID,
      locale,
      subject: "Hindi Test Subject",
      body: "Hindi Test Body {{name}}",
      status,
      createdBy: ACTOR,
      updatedBy: ACTOR,
      version: 1,
    }).onConflictDoNothing();
  }));
}

async function deliver(topic: string, messageId: string, payload: unknown): Promise<MemoryQueue> {
  deliveredMessageIds.add(messageId);
  const q = new MemoryQueue();
  registerI18nConsumers(q);
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

describe("POST /v1/templates/:templateId/locales", () => {
  beforeEach(cleanup);

  const validBody = {
    templateId: TEMPLATE_ID,
    locale: "hi-IN",
    subject: "Test Subject",
    body: "Test Body {{name}}",
  };

  it("202 for an admin creating a locale variant", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/templates/${TEMPLATE_ID}/locales`,
      headers: bearer(["notification_admin"]),
      payload: validBody,
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("400 for invalid BCP 47 locale (underscore)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/templates/${TEMPLATE_ID}/locales`,
      headers: bearer(["notification_admin"]),
      payload: { ...validBody, locale: "en_US" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("INVALID_LOCALE");
  });

  it("400 for empty body text", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/templates/${TEMPLATE_ID}/locales`,
      headers: bearer(["notification_admin"]),
      payload: { ...validBody, body: "" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for invalid templateId param", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/templates/not-a-uuid/locales",
      headers: bearer(["notification_admin"]),
      payload: validBody,
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("409 for duplicate locale on same template", async () => {
    await seedVariant("hi-IN");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/templates/${TEMPLATE_ID}/locales`,
      headers: bearer(["notification_admin"]),
      payload: validBody,
    });
    await app.close();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("DUPLICATE_LOCALE");
  });

  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/templates/${TEMPLATE_ID}/locales`,
      payload: validBody,
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a non-admin role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/templates/${TEMPLATE_ID}/locales`,
      headers: bearer(["employee"]),
      payload: validBody,
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("202 accepts optional subject field omitted", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/templates/${TEMPLATE_ID}/locales`,
      headers: bearer(["tenant_admin"]),
      payload: { templateId: TEMPLATE_ID, locale: "ta", body: "Tamil body" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });
});

describe("GET /v1/templates/:templateId/locales", () => {
  beforeEach(async () => {
    await cleanup();
    await seedVariant("hi-IN");
  });

  it("200 lists locale variants for a template", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/templates/${TEMPLATE_ID}/locales`,
      headers: bearer(["notification_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data[0]).toHaveProperty("locale");
    expect(data[0]).toHaveProperty("body");
    expect(res.json().meta.total).toBeGreaterThanOrEqual(1);
  });

  it("200 returns empty list for a template with no variants", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/templates/eeee9999-1111-4000-8000-000000000001/locales`,
      headers: bearer(["notification_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/templates/${TEMPLATE_ID}/locales`,
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

describe("PATCH /v1/templates/:templateId/locales/:id", () => {
  beforeEach(async () => {
    await cleanup();
    await seedVariant("hi-IN");
  });

  it("202 for updating body text", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/templates/${TEMPLATE_ID}/locales/${VARIANT_ID}`,
      headers: bearer(["notification_admin"]),
      payload: { body: "Updated Hindi Body" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("202 for updating status to needs_review", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/templates/${TEMPLATE_ID}/locales/${VARIANT_ID}`,
      headers: bearer(["super_admin"]),
      payload: { status: "needs_review" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("400 for invalid status value", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/templates/${TEMPLATE_ID}/locales/${VARIANT_ID}`,
      headers: bearer(["notification_admin"]),
      payload: { status: "archived" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/templates/${TEMPLATE_ID}/locales/${VARIANT_ID}`,
      payload: { body: "Updated" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/templates/${TEMPLATE_ID}/locales/${VARIANT_ID}`,
      headers: bearer(["employee"]),
      payload: { body: "Updated" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("i18n consumer — createLocaleVariant", () => {
  beforeEach(cleanup);

  const createPayload = {
    id: VARIANT_ID,
    tenantId: TENANT,
    templateId: TEMPLATE_ID,
    locale: "hi-IN",
    subject: "Hindi Subject",
    body: "Hindi Body {{name}}",
  };

  async function rows() {
    return runWithTenant(TENANT, () => db.transaction(async (tx) => ({
      variants: await tx.select().from(localeVariants).where(eq(localeVariants.tenantId, TENANT)),
      outbox: await tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)),
    })));
  }

  it("creates a locale variant with status current", async () => {
    await deliver(COMMANDS.createLocaleVariant, "eeee3333-1111-4000-8000-0000000a0001", createPayload);
    const { variants, outbox } = await rows();
    expect(variants).toHaveLength(1);
    expect(variants[0]).toMatchObject({
      locale: "hi-IN",
      body: "Hindi Body {{name}}",
      status: "current",
    });
    expect(outbox.map((m) => m.eventType)).toContain(EVENTS.localeVariantCreated);
    expect(outbox.map((m) => m.eventType)).toContain("audit.event.record");
  });

  it("idempotent — delivering same messageId twice writes one row", async () => {
    const MSG = "eeee3333-1111-4000-8000-0000000a0002";
    await deliver(COMMANDS.createLocaleVariant, MSG, createPayload);
    const first = await rows();
    await deliver(COMMANDS.createLocaleVariant, MSG, createPayload);
    const second = await rows();
    expect(second.variants).toHaveLength(first.variants.length);
    expect(second.outbox).toHaveLength(first.outbox.length);
  });

  it("duplicate locale suppressed — same template+locale results in no extra row", async () => {
    await deliver(COMMANDS.createLocaleVariant, "eeee3333-1111-4000-8000-0000000a0003", createPayload);
    // Second delivery with DIFFERENT messageId but same template+locale
    await deliver(COMMANDS.createLocaleVariant, "eeee3333-1111-4000-8000-0000000a0004", {
      ...createPayload,
      id: "eeee2222-1111-4000-8000-000000ba1002",
    });
    const { variants } = await rows();
    expect(variants).toHaveLength(1); // consumer checks for existing and skips
  });

  it("stores subject as null when omitted", async () => {
    await deliver(COMMANDS.createLocaleVariant, "eeee3333-1111-4000-8000-0000000a0005", {
      ...createPayload,
      id: "eeee2222-1111-4000-8000-000000ba1003",
      locale: "ta",
      subject: undefined,
    });
    const { variants } = await rows();
    const ta = variants.find((v) => v.locale === "ta");
    expect(ta?.subject).toBeNull();
  });
});

describe("i18n consumer — updateLocaleVariant", () => {
  beforeEach(async () => {
    await cleanup();
    await seedVariant("hi-IN");
  });

  async function rows() {
    return runWithTenant(TENANT, () => db.transaction(async (tx) => ({
      variants: await tx.select().from(localeVariants).where(eq(localeVariants.tenantId, TENANT)),
      outbox: await tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)),
    })));
  }

  it("updates body text", async () => {
    await deliver(COMMANDS.updateLocaleVariant, "eeee3333-1111-4000-8000-0000000a0010", {
      id: VARIANT_ID,
      tenantId: TENANT,
      body: "Updated Hindi Body",
    });
    const { variants, outbox } = await rows();
    expect(variants[0]?.body).toBe("Updated Hindi Body");
    expect(outbox.map((m) => m.eventType)).toContain("audit.event.record");
  });

  it("updates status to needs_review", async () => {
    await deliver(COMMANDS.updateLocaleVariant, "eeee3333-1111-4000-8000-0000000a0011", {
      id: VARIANT_ID,
      tenantId: TENANT,
      status: "needs_review",
    });
    const { variants } = await rows();
    expect(variants[0]?.status).toBe("needs_review");
  });

  it("idempotent — same messageId twice applies once", async () => {
    const MSG = "eeee3333-1111-4000-8000-0000000a0012";
    await deliver(COMMANDS.updateLocaleVariant, MSG, {
      id: VARIANT_ID, tenantId: TENANT, body: "Once",
    });
    await deliver(COMMANDS.updateLocaleVariant, MSG, {
      id: VARIANT_ID, tenantId: TENANT, body: "Twice",
    });
    const { variants } = await rows();
    expect(variants[0]?.body).toBe("Once"); // second delivery no-op
  });
});

describe("flagVariantsOnBaseUpdate — stale flagging", () => {
  beforeEach(async () => {
    await cleanup();
    // Seed two current variants for the same template
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(localeVariants).values([
        {
          id: "eeee2222-1111-4000-8000-000000fa0001",
          tenantId: TENANT,
          templateId: TEMPLATE_ID,
          locale: "hi",
          body: "Hindi body",
          status: "current",
          createdBy: ACTOR,
          updatedBy: ACTOR,
          version: 1,
        },
        {
          id: "eeee2222-1111-4000-8000-000000fa0002",
          tenantId: TENANT,
          templateId: TEMPLATE_ID,
          locale: "en",
          body: "English body",
          status: "current",
          createdBy: ACTOR,
          updatedBy: ACTOR,
          version: 1,
        },
        {
          id: "eeee2222-1111-4000-8000-000000fa0003",
          tenantId: TENANT,
          templateId: TEMPLATE_ID,
          locale: "mr",
          body: "Marathi body",
          status: "needs_review",
          createdBy: ACTOR,
          updatedBy: ACTOR,
          version: 1,
        },
      ]).onConflictDoNothing();
    }));
  });

  it("flags all current variants as needs_review and returns count", async () => {
    const count = await runWithTenant(TENANT, () => flagVariantsOnBaseUpdate(TENANT, TEMPLATE_ID, ACTOR));
    expect(count).toBe(2); // hi + en are current, mr is already needs_review

    const variants = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(localeVariants)
        .where(and(eq(localeVariants.tenantId, TENANT), eq(localeVariants.templateId, TEMPLATE_ID))),
    ));
    const statuses = variants.map((v) => v.status);
    expect(statuses.every((s) => s === "needs_review")).toBe(true);
  });

  it("returns 0 when all variants are already stale", async () => {
    // Flag first
    await runWithTenant(TENANT, () => flagVariantsOnBaseUpdate(TENANT, TEMPLATE_ID, ACTOR));
    // Flag again
    const count = await runWithTenant(TENANT, () => flagVariantsOnBaseUpdate(TENANT, TEMPLATE_ID, ACTOR));
    expect(count).toBe(0);
  });

  it("returns 0 for a template with no variants", async () => {
    const count = await runWithTenant(TENANT, () => flagVariantsOnBaseUpdate(TENANT, "eeee9999-1111-4000-8000-000000000001", ACTOR));
    expect(count).toBe(0);
  });
});
