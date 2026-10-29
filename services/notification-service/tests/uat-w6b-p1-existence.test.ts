/**
 * UAT W6 P1 (accept-nonexistent): every command route below used to publish and
 * return 202 for ANY well-formed id, because it never read the target row. The
 * routes now do a tenant-scoped existence read first: an unknown (or another
 * tenant's) id is a 404 and NOTHING is published; a real id still gets 202 and
 * the command is published (the consumer stays the race-safe authority).
 *
 * Also pins UAT W6 P9b: the paginated list GETs default `limit` instead of 400.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { COMMANDS } from "../src/topics.js";
import { notificationAlertRules } from "../src/modules/alerts/schema.js";
import { notificationCampaigns } from "../src/modules/bulk/schema.js";
import { notificationTemplates } from "../src/modules/templates/schema.js";
import { digestRules } from "../src/modules/digest/schema.js";
import { localeVariants } from "../src/modules/i18n/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const CREATOR = randomUUID();

const bearer = (tid = TENANT) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles: ["notification_admin", "super_admin", "tenant_admin", "crm_admin", "employee"], sid: "sess-w6b" }, SECRET, 3600)}`,
});

const ids = {
  alert: randomUUID(), campaign: randomUUID(), template: randomUUID(),
  digest: randomUUID(), templateForVariant: randomUUID(), variant: randomUUID(),
};

function inTenant<T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>): Promise<T> {
  return runWithTenant(TENANT, () => db.transaction(fn)) as Promise<T>;
}

async function cleanup(): Promise<void> {
  await inTenant(async (tx) => {
    await tx.delete(notificationAlertRules).where(eq(notificationAlertRules.tenantId, TENANT));
    await tx.delete(notificationCampaigns).where(eq(notificationCampaigns.tenantId, TENANT));
    await tx.delete(notificationTemplates).where(eq(notificationTemplates.tenantId, TENANT));
    await tx.delete(digestRules).where(eq(digestRules.tenantId, TENANT));
    await tx.delete(localeVariants).where(eq(localeVariants.tenantId, TENANT));
  });
}

let app: FastifyInstance;
beforeAll(async () => {
  await cleanup();
  await inTenant(async (tx) => {
    const who = { createdBy: CREATOR, updatedBy: CREATOR };
    await tx.insert(notificationAlertRules).values({
      id: ids.alert, tenantId: TENANT, name: "w6b rule", triggerEvent: "x.y", channel: "email", ...who,
    });
    await tx.insert(notificationCampaigns).values({
      id: ids.campaign, tenantId: TENANT, templateId: randomUUID(), name: "w6b campaign", status: "draft",
      scheduledAt: null, objective: null, audienceSegmentId: null, budgetMinor: 0n, currency: "INR", ...who,
    } as typeof notificationCampaigns.$inferInsert);
    await tx.insert(notificationTemplates).values({
      id: ids.template, tenantId: TENANT, channel: "email", name: "w6b template", body: "Hello", ...who,
    } as typeof notificationTemplates.$inferInsert);
    await tx.insert(digestRules).values({
      id: ids.digest, tenantId: TENANT, eventType: "x.y", channel: "email",
      accumulationWindowMinutes: 60, digestTemplateId: randomUUID(), ...who,
    });
    await tx.insert(localeVariants).values({
      id: ids.variant, tenantId: TENANT, templateId: ids.templateForVariant, locale: "hi-IN",
      subject: "s", body: "b", status: "current", version: 1, ...who,
    });
  });
  app = await buildApp();
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

type Case = { name: string; method: "PATCH" | "DELETE"; url: (id: string) => string; real: () => string; topic: string; payload?: unknown };
const cases: Case[] = [
  { name: "PATCH /notifications/templates/:id", method: "PATCH", url: (id) => `/notifications/templates/${id}`, real: () => ids.template, topic: COMMANDS.updateTemplate, payload: { name: "Renamed" } },
  { name: "PATCH /notifications/alert-rules/:id/enable", method: "PATCH", url: (id) => `/notifications/alert-rules/${id}/enable`, real: () => ids.alert, topic: COMMANDS.enableAlertRule },
  { name: "PATCH /notifications/alert-rules/:id/disable", method: "PATCH", url: (id) => `/notifications/alert-rules/${id}/disable`, real: () => ids.alert, topic: COMMANDS.disableAlertRule },
  { name: "PATCH /notifications/campaigns/:id/cancel", method: "PATCH", url: (id) => `/notifications/campaigns/${id}/cancel`, real: () => ids.campaign, topic: COMMANDS.cancelCampaign },
  { name: "PATCH /v1/digest-rules/:id", method: "PATCH", url: (id) => `/v1/digest-rules/${id}`, real: () => ids.digest, topic: COMMANDS.updateDigestRule, payload: { accumulationWindowMinutes: 30 } },
  { name: "DELETE /v1/digest-rules/:id", method: "DELETE", url: (id) => `/v1/digest-rules/${id}`, real: () => ids.digest, topic: COMMANDS.updateDigestRule },
  { name: "PATCH /v1/templates/:templateId/locales/:id", method: "PATCH", url: (id) => `/v1/templates/${ids.templateForVariant}/locales/${id}`, real: () => ids.variant, topic: COMMANDS.updateLocaleVariant, payload: { body: "Updated" } },
];

describe("UAT W6 P1 — commands on a non-existent id are 404, real ids still 202", () => {
  for (const c of cases) {
    it(`${c.name}: random id → 404, nothing published`, async () => {
      const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
      const res = await app.inject({ method: c.method, url: c.url(randomUUID()), headers: bearer(), ...(c.payload ? { payload: c.payload } : {}) });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe("NOT_FOUND");
      expect(spy).not.toHaveBeenCalled();
    });

    it(`${c.name}: real id → 202 and the command is published`, async () => {
      const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
      const res = await app.inject({ method: c.method, url: c.url(c.real()), headers: bearer(), ...(c.payload ? { payload: c.payload } : {}) });
      expect(res.statusCode).toBe(202);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]?.[0]).toBe(c.topic);
    });

    it(`${c.name}: another tenant's id → 404, nothing published`, async () => {
      const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
      const res = await app.inject({ method: c.method, url: c.url(c.real()), headers: bearer(OTHER_TENANT), ...(c.payload ? { payload: c.payload } : {}) });
      expect(res.statusCode).toBe(404);
      expect(spy).not.toHaveBeenCalled();
    });
  }

  it("PATCH /v1/templates/:templateId/locales/:id: real variant under the WRONG template → 404", async () => {
    const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    const res = await app.inject({
      method: "PATCH", url: `/v1/templates/${randomUUID()}/locales/${ids.variant}`,
      headers: bearer(), payload: { body: "Updated" },
    });
    expect(res.statusCode).toBe(404);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("UAT W6 P9b — list GETs default limit instead of 400", () => {
  for (const url of [
    "/v1/notification/inbox/keyword-rules",
    "/v1/notification/email/sending-domains",
    "/v1/notification/suppressions",
    "/v1/notification/experiments",
    "/v1/notification/push/subscriptions",
    // Shares the push list schema (inboxQuery extends listQuery), so it gets the same default.
    "/v1/notification/in-app/messages",
  ]) {
    it(`GET ${url} without ?limit → 200, pageSize 50`, async () => {
      const res = await app.inject({ method: "GET", url, headers: bearer() });
      expect(res.statusCode).toBe(200);
      expect(res.json().meta.pageSize).toBe(50);
    });

    it(`GET ${url}?limit=201 → 400 (cap kept)`, async () => {
      const res = await app.inject({ method: "GET", url: `${url}?limit=201`, headers: bearer() });
      expect(res.statusCode).toBe(400);
    });
  }
});
