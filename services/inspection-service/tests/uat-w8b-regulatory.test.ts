/**
 * UAT W8-B (inspection-service), driven against a real Postgres.
 *
 *  P1   POST /v1/inspection/tour-plans/:id/submit, .../approve and POST /v1/inspection/inspections/:id/finalize
 *       published without reading their target, so a random id got 202. Each now does a tenant-scoped
 *       existence read first: random id -> 404 and nothing published; another tenant's row -> 404;
 *       a real row -> 202 and the command is published (the consumer stays the race-safe authority).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { tourPlans } from "../src/modules/assignment/schema.js";
import { inspections } from "../src/modules/execution/schema.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const ids = { tourPlan: randomUUID(), inspection: randomUUID() };

const bearer = (tenantId = TENANT) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenantId, roles: ["super_admin", "tenant_admin"], sid: "s-w8b" }, SECRET, 3600)}`,
});
const asTenant = (fn: Parameters<typeof db.transaction>[0]) => runWithTenant(TENANT, () => db.transaction(fn));

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await asTenant(async (tx) => {
    await tx.insert(tourPlans).values({
      id: ids.tourPlan, tenantId: TENANT, inspectorId: ACTOR, periodStart: "2026-11-01", periodEnd: "2026-11-07", slots: [],
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(inspections).values({
      id: ids.inspection, tenantId: TENANT, entityId: randomUUID(), inspectionTypeId: randomUUID(), state: "under_review",
      assignedInspectors: [ACTOR], createdBy: ACTOR, updatedBy: ACTOR,
    });
  });
});

afterAll(async () => {
  await asTenant(async (tx) => {
    await tx.delete(inspections).where(eq(inspections.id, ids.inspection));
    await tx.delete(tourPlans).where(eq(tourPlans.id, ids.tourPlan));
  }).catch(() => undefined);
  await app.close();
  await sqlClient.end();
});

const cases: Array<{ name: string; url: (id: string) => string; realId: () => string }> = [
  { name: "tour plan submit", url: (id) => `/v1/inspection/tour-plans/${id}/submit`, realId: () => ids.tourPlan },
  { name: "tour plan approve", url: (id) => `/v1/inspection/tour-plans/${id}/approve`, realId: () => ids.tourPlan },
  { name: "inspection finalize", url: (id) => `/v1/inspection/inspections/${id}/finalize`, realId: () => ids.inspection },
];

describe("UAT W8-B P1: inspection command routes answer 404 for a record that does not exist", () => {
  for (const c of cases) {
    it(`${c.name}: random id -> 404 NOT_FOUND, nothing published`, async () => {
      const spy = vi.spyOn(queue, "publish");
      try {
        const res = await app.inject({ method: "POST", url: c.url(randomUUID()), headers: bearer(), payload: {} });
        expect(res.statusCode).toBe(404);
        expect(res.json().code).toBe("NOT_FOUND");
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });

    it(`${c.name}: another tenant's real id -> 404, nothing published`, async () => {
      const spy = vi.spyOn(queue, "publish");
      try {
        const res = await app.inject({ method: "POST", url: c.url(c.realId()), headers: bearer(OTHER_TENANT), payload: {} });
        expect(res.statusCode).toBe(404);
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });

    it(`${c.name}: real id -> 202 and the command is published`, async () => {
      const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
      try {
        const res = await app.inject({ method: "POST", url: c.url(c.realId()), headers: bearer(), payload: {} });
        expect(res.statusCode).toBe(202);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0]![1]).toMatchObject({ tenantId: TENANT });
      } finally {
        spy.mockRestore();
      }
    });

    it(`${c.name}: malformed id -> 400`, async () => {
      const res = await app.inject({ method: "POST", url: c.url("not-a-uuid"), headers: bearer(), payload: {} });
      expect(res.statusCode).toBe(400);
    });
  }
});
