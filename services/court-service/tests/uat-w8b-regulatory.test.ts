/**
 * UAT W8-B (court-service), driven against a real Postgres.
 *
 *  P1   POST /v1/court/cases/:id/certified-copies and POST /v1/court/cases/:id/scrutiny published
 *       without reading the case, so a random id got 202. Each now does a tenant-scoped case read
 *       first: random id -> 404 and nothing published; another tenant's case -> 404; real case -> 202.
 *  5xx  GET /v1/court/config/:namespace 500'd for any namespace outside NAMESPACE_PATTERN (the domain
 *       assert threw a plain Error); now 400. Same for /v1/court/config-entry's namespace/key.
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
import { cases } from "../src/modules/case-registry/schema.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const CASE_ID = randomUUID();

const bearer = (tenantId = TENANT) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenantId, roles: ["super_admin", "court_admin", "registrar"], sid: "s-w8b" }, SECRET, 3600)}`,
});

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(cases).values({
    id: CASE_ID, tenantId: TENANT, cnrNumber: `W8B${Date.now().toString(36).toUpperCase()}`, title: "W8B case", status: "filed", createdBy: ACTOR, updatedBy: ACTOR,
  })));
});

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.delete(cases).where(eq(cases.id, CASE_ID)))).catch(() => undefined);
  await app.close();
  await sqlClient.end();
});

const cases_: Array<{ name: string; url: (id: string) => string; payload: Record<string, unknown> }> = [
  { name: "certified copy request", url: (id) => `/v1/court/cases/${id}/certified-copies`, payload: {} },
  { name: "scrutiny record", url: (id) => `/v1/court/cases/${id}/scrutiny`, payload: {} },
];

describe("UAT W8-B P1: court case commands answer 404 for a case that does not exist", () => {
  for (const c of cases_) {
    it(`${c.name}: random case id -> 404 CASE_NOT_FOUND, nothing published`, async () => {
      const spy = vi.spyOn(queue, "publish");
      try {
        const res = await app.inject({ method: "POST", url: c.url(randomUUID()), headers: bearer(), payload: c.payload });
        expect(res.statusCode).toBe(404);
        expect(res.json().error.code).toBe("CASE_NOT_FOUND");
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });

    it(`${c.name}: another tenant's real case -> 404, nothing published`, async () => {
      const spy = vi.spyOn(queue, "publish");
      try {
        const res = await app.inject({ method: "POST", url: c.url(CASE_ID), headers: bearer(OTHER_TENANT), payload: c.payload });
        expect(res.statusCode).toBe(404);
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });

    it(`${c.name}: real case -> 202 and the command is published`, async () => {
      const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
      try {
        const res = await app.inject({ method: "POST", url: c.url(CASE_ID), headers: bearer(), payload: c.payload });
        expect(res.statusCode).toBe(202);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0]![1]).toMatchObject({ tenantId: TENANT });
      } finally {
        spy.mockRestore();
      }
    });
  }

  it("invalid body fields are still a 400 before the existence read", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/court/cases/${CASE_ID}/scrutiny`, headers: bearer(), payload: { status: "nope" } });
    expect(res.statusCode).toBe(400);
  });
});

describe("UAT W8-B 5xx: GET /v1/court/config/:namespace", () => {
  it.each(["not-a-namespace", "ABC", "1abc", "a.b", "x", "a".repeat(80), randomUUID()])("invalid namespace %s -> 400, not 500", async (ns) => {
    const res = await app.inject({ method: "GET", url: `/v1/court/config/${encodeURIComponent(ns)}`, headers: bearer() });
    expect(res.statusCode).toBe(400);
  });

  it("a valid but empty namespace -> 200 with no items", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/court/config/w8b_empty", headers: bearer() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ items: [], count: 0 });
  });

  it("config-entry with a bad namespace or key -> 400; a valid unknown key -> 404", async () => {
    for (const q of ["namespace=Bad-NS&key=k", "namespace=court_type&key=-bad", "namespace=court_type", ""]) {
      const res = await app.inject({ method: "GET", url: `/v1/court/config-entry?${q}`, headers: bearer() });
      expect(res.statusCode, q).toBe(400);
    }
    const res = await app.inject({ method: "GET", url: "/v1/court/config-entry?namespace=court_type&key=w8b.unknown", headers: bearer() });
    expect(res.statusCode).toBe(404);
  });
});
