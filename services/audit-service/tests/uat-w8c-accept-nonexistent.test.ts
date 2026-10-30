/**
 * UAT W8-C (P1 accept-nonexistent): PATCH /v1/audit/plans/:id/start and the para commands
 * (issue / settle / pending_recovery / close) published without reading their target, so a random id
 * got 202. Each now does a tenant-scoped existence read first: random id -> 404 and nothing published;
 * a real row -> 202 and the command is published (the consumer stays the race-safe authority).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { auditParas } from "../src/modules/para/schema.js";
import { auditPlans } from "../src/modules/plan/schema.js";

const SECRET = process.env.JWT_SECRET as string;
// Random per run: audit_paras is a case-of-record table (migration 0027 rejects DELETE), so rows from
// earlier runs must never collide.
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const PARA = randomUUID();
const PLAN = randomUUID();
const INVALID_FIELDS = { id: "x".repeat(5000), amount: -1, email: "not-an-email", date: "31-31-2026" };

const headers = (tenant = TENANT) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles: ["audit_admin"], sid: "s-w8c" }, SECRET, 3600)}`,
});

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(auditParas).values({
      id: PARA, tenantId: TENANT, paraNo: `W8C-${PARA.slice(0, 8)}`, deptRef: "dept:finance", body: "w8c",
      category: "financial", amountInvolvedMinor: 0n, status: "draft", createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(auditPlans).values({
      id: PLAN, tenantId: TENANT, planNo: `W8C-${PLAN.slice(0, 8)}`, title: "w8c", area: "finance",
      periodFrom: "2026-04-01", periodTo: "2027-03-31", createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
});

afterAll(async () => {
  await app.close();
});

afterEach(() => vi.restoreAllMocks());

const ROUTES = [
  { method: "PATCH" as const, url: (id: string) => `/v1/audit/plans/${id}/start`, real: PLAN },
  { method: "POST" as const, url: (id: string) => `/v1/audit/paras/${id}/issue`, real: PARA },
  { method: "PATCH" as const, url: (id: string) => `/v1/audit/paras/${id}/settle`, real: PARA },
  { method: "PATCH" as const, url: (id: string) => `/v1/audit/paras/${id}/pending_recovery`, real: PARA },
  { method: "PATCH" as const, url: (id: string) => `/v1/audit/paras/${id}/close`, real: PARA },
];

describe("audit commands on an unknown id -> 404, nothing published (was 202)", () => {
  for (const r of ROUTES) {
    const label = `${r.method} ${r.url(":id")}`;
    it(`${label}: random id (empty and invalid-field bodies)`, async () => {
      const spy = vi.spyOn(queue, "publish");
      for (const payload of [{}, INVALID_FIELDS]) {
        const res = await app.inject({ method: r.method, url: r.url(randomUUID()), headers: headers(), payload });
        expect(res.statusCode).toBe(404);
      }
      expect(spy).not.toHaveBeenCalled();
    });
    it(`${label}: another tenant's row -> 404`, async () => {
      const res = await app.inject({ method: r.method, url: r.url(r.real), headers: headers(OTHER_TENANT), payload: {} });
      expect(res.statusCode).toBe(404);
    });
    it(`${label}: the real row -> 202`, async () => {
      const res = await app.inject({ method: r.method, url: r.url(r.real), headers: headers(), payload: {} });
      expect(res.statusCode).toBe(202);
    });
  }
});
