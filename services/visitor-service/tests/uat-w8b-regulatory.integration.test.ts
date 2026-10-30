/**
 * UAT W8-B (visitor-service), driven against a real Postgres.
 *
 *  P1   badge template PATCH / archive, print-job requeue, device PATCH / activate / suspend /
 *       deregister / rotate-credential / PUT config and recurring-pass revoke all published without
 *       reading their target, so a random id got 202 (rotate-credential even minted a device token
 *       for a device that does not exist). Each now does a tenant-scoped existence read first:
 *       random id -> 404 and nothing published; another tenant's real id -> 404; a real row -> 202.
 *  5xx  GET /v1/visitor/config/:namespace 500'd for any namespace outside NAMESPACE_PATTERN
 *       (domain assert threw a plain Error); now 400.
 *  5xx  GET /v1/visitor/visit-requests 500'd for the whole list when ONE row's PII envelope
 *       could not be decrypted; that row is now returned masked + flagged.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { buildApp } from "../src/app.js";
import { locations } from "../src/modules/location/schema.js";
import { devices } from "../src/modules/device-registry/schema.js";
import { badgeTemplates, printJobs } from "../src/modules/badge-print/schema.js";
import { recurringPasses } from "../src/modules/recurring-pass/schema.js";
import { digitalPasses } from "../src/modules/digital-pass/schema.js";
import { visitRequests } from "../src/modules/visit-request/schema.js";
import { UNDECRYPTABLE_PII_PLACEHOLDER } from "../src/modules/blacklist/repo.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const LOCATION = randomUUID();
const BUSINESS_HOURS = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };

const ids = {
  template: randomUUID(), device: randomUUID(), job: randomUUID(),
  visitRequest: randomUUID(), badVisitRequest: randomUUID(), digitalPass: randomUUID(), recurringPass: randomUUID(),
};

const bearer = (tenantId = TENANT) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenantId, roles: ["super_admin", "security_admin", "facility_admin"], sid: "s-w8b" }, SECRET, 3600)}`,
});
const asTenant = <T>(fn: Parameters<typeof db.transaction>[0]) => runWithTenant(TENANT, () => db.transaction(fn)) as Promise<T>;

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await asTenant(async (tx) => {
    await tx.insert(locations).values({ id: LOCATION, tenantId: TENANT, name: "W8B HQ", businessHours: BUSINESS_HOURS, createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(devices).values({
      id: ids.device, tenantId: TENANT, deviceType: "printer", name: "W8B printer", serialNumber: `W8B-${randomUUID().slice(0, 8)}`,
      locationId: LOCATION, status: "active", authType: "bearer_token", deviceTokenHash: "c".repeat(64), createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(badgeTemplates).values({
      id: ids.template, tenantId: TENANT, name: "W8B template", printerLanguage: "zpl", templateBody: "^FD{{visitor_name}}^FS", createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(visitRequests).values({
      id: ids.visitRequest, tenantId: TENANT, locationId: LOCATION, hostEmployeeId: ACTOR, passType: "recurring",
      visitorName: "W8B Readable Visitor", visitorPhone: "+919900012345", createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(digitalPasses).values({
      id: ids.digitalPass, tenantId: TENANT, visitRequestId: ids.visitRequest, locationId: LOCATION,
      passNumber: "W8B" + Math.floor(Math.random() * 1e9), passType: "recurring", status: "active",
      qrJwt: "x", validFrom: new Date(), validUntil: new Date(Date.now() + 30 * 86_400_000), createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(printJobs).values({ id: ids.job, tenantId: TENANT, deviceId: ids.device, passId: ids.digitalPass, templateId: ids.template, status: "failed" });
    await tx.insert(recurringPasses).values({
      id: ids.recurringPass, tenantId: TENANT, locationId: LOCATION, passId: ids.digitalPass,
      visitorName: "W8B Contractor", visitorPhone: "+911234567890",
      validFrom: new Date(Date.now() - 86_400_000), validUntil: new Date(Date.now() + 30 * 86_400_000),
      permittedDays: [0, 1, 2, 3, 4, 5, 6], status: "active", issuedBy: ACTOR, createdBy: ACTOR, updatedBy: ACTOR,
    });
    // A visit request whose PII envelope the current keyring cannot open (retired key id).
    await tx.execute(sql`INSERT INTO visitor.visit_requests (id, tenant_id, location_id, host_employee_id, visitor_name, visitor_phone, created_by, updated_by)
      VALUES (${ids.badVisitRequest}::uuid, ${TENANT}::uuid, ${LOCATION}::uuid, ${ACTOR}::uuid,
              ${"enc:v2:retired-key:" + Buffer.alloc(40, 7).toString("base64")}, ${"enc:v2:retired-key:" + Buffer.alloc(40, 9).toString("base64")},
              ${ACTOR}::uuid, ${ACTOR}::uuid)`);
  });
});

afterAll(async () => {
  await asTenant(async (tx) => {
    await tx.delete(recurringPasses).where(eq(recurringPasses.id, ids.recurringPass));
    await tx.delete(printJobs).where(eq(printJobs.id, ids.job));
    await tx.delete(digitalPasses).where(eq(digitalPasses.id, ids.digitalPass));
    await tx.delete(visitRequests).where(inArray(visitRequests.id, [ids.visitRequest, ids.badVisitRequest]));
    await tx.delete(badgeTemplates).where(eq(badgeTemplates.id, ids.template));
    await tx.delete(devices).where(eq(devices.id, ids.device));
    await tx.delete(locations).where(eq(locations.id, LOCATION));
  }).catch(() => undefined);
  await app.close();
  await sqlClient.end();
});

type Case = { name: string; method: "POST" | "PATCH" | "PUT"; url: (id: string) => string; realId: () => string; payload?: Record<string, unknown> };
const cases: Case[] = [
  { name: "badge template update", method: "PATCH", url: (id) => `/v1/visitor/badges/templates/${id}`, realId: () => ids.template, payload: { name: "W8B renamed" } },
  { name: "badge template archive", method: "POST", url: (id) => `/v1/visitor/badges/templates/${id}/archive`, realId: () => ids.template },
  { name: "print job requeue", method: "POST", url: (id) => `/v1/visitor/badges/jobs/${id}/requeue`, realId: () => ids.job },
  { name: "device update", method: "PATCH", url: (id) => `/v1/visitor/devices/${id}`, realId: () => ids.device, payload: { name: "W8B renamed" } },
  { name: "device activate", method: "POST", url: (id) => `/v1/visitor/devices/${id}/activate`, realId: () => ids.device },
  { name: "device suspend", method: "POST", url: (id) => `/v1/visitor/devices/${id}/suspend`, realId: () => ids.device },
  { name: "device deregister", method: "POST", url: (id) => `/v1/visitor/devices/${id}/deregister`, realId: () => ids.device },
  { name: "device rotate-credential", method: "POST", url: (id) => `/v1/visitor/devices/${id}/rotate-credential`, realId: () => ids.device },
  { name: "device config push", method: "PUT", url: (id) => `/v1/visitor/devices/${id}/config`, realId: () => ids.device, payload: { heartbeatIntervalMs: 30000 } },
  { name: "recurring pass revoke", method: "POST", url: (id) => `/v1/visitor/recurring-passes/${id}/revoke`, realId: () => ids.recurringPass, payload: { reason: "w8b" } },
  // W8-B siblings (same pattern, found while fixing the sweep rows).
  { name: "device firmware schedule", method: "POST", url: (id) => `/v1/visitor/devices/${id}/firmware/schedule`, realId: () => ids.device, payload: { firmwareUrl: "https://example.test/fw-w8b.bin", firmwareChecksum: "w8b-sha" } },
  { name: "recurring pass suspend", method: "POST", url: (id) => `/v1/visitor/recurring-passes/${id}/suspend`, realId: () => ids.recurringPass, payload: { reason: "w8b" } },
];

describe("UAT W8-B P1: visitor command routes answer 404 for a record that does not exist", () => {
  for (const c of cases) {
    it(`${c.name}: random id -> 404, nothing published`, async () => {
      const spy = vi.spyOn(queue, "publish");
      try {
        const res = await app.inject({ method: c.method, url: c.url(randomUUID()), headers: bearer(), payload: c.payload ?? {} });
        expect(res.statusCode).toBe(404);
        expect(res.json()).not.toHaveProperty("data.deviceToken");
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });

    it(`${c.name}: another tenant's real id -> 404, nothing published`, async () => {
      const spy = vi.spyOn(queue, "publish");
      try {
        const res = await app.inject({ method: c.method, url: c.url(c.realId()), headers: bearer(OTHER_TENANT), payload: c.payload ?? {} });
        expect(res.statusCode).toBe(404);
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });

    it(`${c.name}: real id -> 202 and the command is published`, async () => {
      const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
      try {
        const res = await app.inject({ method: c.method, url: c.url(c.realId()), headers: bearer(), payload: c.payload ?? {} });
        expect(res.statusCode).toBe(202);
        expect(spy).toHaveBeenCalled();
        expect(spy.mock.calls[0]![1]).toMatchObject({ tenantId: TENANT });
      } finally {
        spy.mockRestore();
      }
    });
  }

  it("a malformed id is still a 400 (param validation runs first)", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/visitor/devices/not-a-uuid/activate", headers: bearer() });
    expect(res.statusCode).toBe(400);
  });
});

describe("UAT W8-B 5xx: GET /v1/visitor/config/:namespace", () => {
  it.each(["not-a-namespace", "ABC", "1abc", "a.b", "x", "a".repeat(80), randomUUID()])("invalid namespace %s -> 400, not 500", async (ns) => {
    const res = await app.inject({ method: "GET", url: `/v1/visitor/config/${encodeURIComponent(ns)}`, headers: bearer() });
    expect(res.statusCode).toBe(400);
  });

  it("a valid but empty namespace -> 200 with no items", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/visitor/config/w8b_empty", headers: bearer() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ items: [], count: 0 });
  });

  it("config-entry with a bad namespace or key -> 400; a valid unknown key -> 404", async () => {
    for (const q of ["namespace=Bad-NS&key=k", "namespace=visitor_policy&key=-bad", "namespace=visitor_policy", ""]) {
      const res = await app.inject({ method: "GET", url: `/v1/visitor/config-entry?${q}`, headers: bearer() });
      expect(res.statusCode, q).toBe(400);
    }
    const res = await app.inject({ method: "GET", url: "/v1/visitor/config-entry?namespace=visitor_policy&key=w8b.unknown", headers: bearer() });
    expect(res.statusCode).toBe(404);
  });
});

describe("UAT W8-B 5xx: GET /v1/visitor/visit-requests with an undecryptable row", () => {
  it("returns 200; the bad row is masked + flagged, the readable row is decrypted and phone-masked", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/visitor/visit-requests?limit=50", headers: bearer() });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<{ id: string; visitorName: string; visitorPhone: string; piiDecryptFailed?: boolean }>;
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(ids.badVisitRequest)).toMatchObject({
      visitorName: UNDECRYPTABLE_PII_PLACEHOLDER, visitorPhone: UNDECRYPTABLE_PII_PLACEHOLDER, piiDecryptFailed: true,
    });
    expect(byId.get(ids.visitRequest)).toMatchObject({ visitorName: "W8B Readable Visitor", visitorPhone: "*********2345" });
    expect(byId.get(ids.visitRequest)).not.toHaveProperty("piiDecryptFailed");
    expect(JSON.stringify(rows)).not.toContain("enc:v2");
    expect(JSON.stringify(rows)).not.toContain("visitorEmail");
  });
});
