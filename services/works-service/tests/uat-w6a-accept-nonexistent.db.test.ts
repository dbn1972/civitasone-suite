/**
 * UAT W6-A (P1 accept-nonexistent): POST /v1/works/execution/issues/:id/close published
 * without reading the issue, so a random id got 202. It now does a tenant-scoped read
 * first (real DB, works_svc under FORCE RLS).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { workIssues } from "../src/modules/execution/schema.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const ISSUE = randomUUID();

const hdr = (tenant = TENANT) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles: ["works_operator"], sid: "s" }, SECRET, 3600)}`,
});

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await runWithTenant(TENANT, () => db.transaction((tx) =>
    tx.insert(workIssues).values({ id: ISSUE, tenantId: TENANT, workId: randomUUID(), raisedDate: new Date(), description: "w6a crack", status: "open" })));
});

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.delete(workIssues).where(eq(workIssues.id, ISSUE)))).catch(() => undefined);
  await app.close();
  await sqlClient.end();
});

describe("UAT W6-A: POST /v1/works/execution/issues/:id/close (real DB)", () => {
  it("random id -> 404, nothing published", async () => {
    const spy = vi.spyOn(queue, "publish");
    try {
      const res = await app.inject({ method: "POST", url: `/v1/works/execution/issues/${randomUUID()}/close`, headers: hdr(), payload: {} });
      expect(res.statusCode).toBe(404);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("another tenant's issue -> 404, nothing published", async () => {
    const spy = vi.spyOn(queue, "publish");
    try {
      const res = await app.inject({ method: "POST", url: `/v1/works/execution/issues/${ISSUE}/close`, headers: hdr(OTHER_TENANT), payload: {} });
      expect(res.statusCode).toBe(404);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("real issue -> 202 and the close command is published", async () => {
    const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    try {
      const res = await app.inject({ method: "POST", url: `/v1/works/execution/issues/${ISSUE}/close`, headers: hdr(), payload: { resolution: "re-grouted" } });
      expect(res.statusCode).toBe(202);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]![1]).toMatchObject({ tenantId: TENANT });
    } finally {
      spy.mockRestore();
    }
  });
});

// UAT W6-A (scope addition): the masters :id lookup reached Postgres with a malformed id and 500ed on the uuid cast.
describe("UAT W6-A: GET /v1/works/masters/:prefix/:id validates the id (real DB)", () => {
  for (const prefix of ["divisions", "work-types", "sr-items"]) {
    it(`${prefix}: malformed id -> 400`, async () => {
      const res = await app.inject({ method: "GET", url: `/v1/works/masters/${prefix}/not-a-uuid`, headers: hdr() });
      expect(res.statusCode).toBe(400);
    });
    it(`${prefix}: well-formed unknown id -> 404`, async () => {
      const res = await app.inject({ method: "GET", url: `/v1/works/masters/${prefix}/${randomUUID()}`, headers: hdr() });
      expect(res.statusCode).toBe(404);
    });
  }
});
