/**
 * UAT W8-B (legal-service), driven against a real Postgres.
 *
 *  P1   PATCH /v1/legal/opinions/:id/issue (and .../draft, same helper) and PATCH /v1/legal/limitations/:id
 *       published without confirming the target exists, so a random id got 202. Each now does a
 *       tenant-scoped existence read first: random id -> 404 and nothing published; another tenant's
 *       row -> 404; a real row -> 202 and the command is published.
 *  5xx  GET /v1/legal/ecourts/cases/:cnr threw a ZodError for a CNR over 30 chars (e.g. a UUID) that
 *       reached Fastify's default handler as a 500. A bad CNR is now 400; a well-formed CNR on a
 *       host where eCourts is not configured is a clean 503 INTEGRATION_DISABLED.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { cache, queue } from "../src/shared/infra.js";
import { legalOpinions } from "../src/modules/opinions/schema.js";
import { limitationRules } from "../src/modules/limitations/schema.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const ids = { opinion: randomUUID(), limitation: randomUUID() };

// x-tenant-id mirrors what the gateway forwards from the verified token (legal's RLS tenant hook reads it).
const bearer = (tenantId = TENANT) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenantId, roles: ["legal_admin", "super_admin"], sid: "s-w8b" }, SECRET, 3600)}`,
  "x-tenant-id": tenantId,
});
const asTenant = (fn: Parameters<typeof db.transaction>[0]) => runWithTenant(TENANT, () => db.transaction(fn));

let app: FastifyInstance;

beforeAll(async () => {
  await asTenant(async (tx) => {
    await tx.insert(legalOpinions).values({
      id: ids.opinion, tenantId: TENANT, opinionNo: `OPN/2026/W8B${Date.now().toString(36)}`.slice(0, 32), subject: "W8B", question: "Q?",
      status: "drafted", createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(limitationRules).values({
      id: ids.limitation, tenantId: TENANT, matterId: randomUUID(), ruleType: "appeal", startDate: new Date("2026-10-01T00:00:00Z"),
      periodDays: 90, deadline: new Date("2026-12-30T00:00:00Z"), createdBy: ACTOR, updatedBy: ACTOR,
    });
  });
  await cache.invalidateResource(TENANT, "cases");
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await asTenant(async (tx) => {
    await tx.delete(limitationRules).where(eq(limitationRules.id, ids.limitation));
    await tx.delete(legalOpinions).where(eq(legalOpinions.id, ids.opinion));
  }).catch(() => undefined);
  await app.close();
  await sqlClient.end();
});

const cases: Array<{ name: string; url: (id: string) => string; realId: () => string; payload: Record<string, unknown> }> = [
  { name: "opinion issue", url: (id) => `/v1/legal/opinions/${id}/issue`, realId: () => ids.opinion, payload: { opinionText: "W8B opinion" } },
  { name: "opinion draft", url: (id) => `/v1/legal/opinions/${id}/draft`, realId: () => ids.opinion, payload: { counselName: "Adv. W8B", opinionText: "W8B draft" } },
  { name: "limitation update", url: (id) => `/v1/legal/limitations/${id}`, realId: () => ids.limitation, payload: { periodDays: 120 } },
];

describe("UAT W8-B P1: legal command routes answer 404 for a record that does not exist", () => {
  for (const c of cases) {
    it(`${c.name}: random id -> 404 NOT_FOUND, nothing published`, async () => {
      const spy = vi.spyOn(queue, "publish");
      try {
        const res = await app.inject({ method: "PATCH", url: c.url(randomUUID()), headers: bearer(), payload: c.payload });
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
        const res = await app.inject({ method: "PATCH", url: c.url(c.realId()), headers: bearer(OTHER_TENANT), payload: c.payload });
        expect(res.statusCode).toBe(404);
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });

    it(`${c.name}: real id -> 202 and the command is published`, async () => {
      const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
      try {
        const res = await app.inject({ method: "PATCH", url: c.url(c.realId()), headers: bearer(), payload: c.payload });
        expect(res.statusCode).toBe(202);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0]![1]).toMatchObject({ tenantId: TENANT });
      } finally {
        spy.mockRestore();
      }
    });
  }

  it("limitation update keeps body validation: invalid fields -> 400", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/legal/limitations/${ids.limitation}`, headers: bearer(), payload: { periodDays: -1 } });
    expect(res.statusCode).toBe(400);
  });
});

describe("UAT W8-B 5xx: GET /v1/legal/ecourts/cases/:cnr (eCourts not configured)", () => {
  it.each([randomUUID(), "00000000-0000-0000-0000-000000000000", "X".repeat(31)])("over-long CNR %s -> 400, not 500", async (cnr) => {
    const res = await app.inject({ method: "GET", url: `/v1/legal/ecourts/cases/${cnr}`, headers: bearer() });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_FAILED");
  });

  it("a well-formed CNR -> 503 INTEGRATION_DISABLED", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/legal/ecourts/cases/DLHC010012342024", headers: bearer() });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("INTEGRATION_DISABLED");
  });
});
