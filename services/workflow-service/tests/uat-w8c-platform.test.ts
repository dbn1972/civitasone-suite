/**
 * UAT W8-C (live API sweep, platform package) — workflow-service.
 *
 * 1. POST /v1/workflow/nurture-rules answered 500 for {} / unknown fields: registerSchemaErrorHandler ran
 *    AFTER the route plugins and the nurture module has no handler of its own, so the ZodError fell
 *    through to Fastify's default 500.
 * 2. finalize / reversal-impact / guarded-edit on an instance, and SLA pause / resume on a task, never
 *    read their target: a random id got 202 (finalize, pause, resume) or a fabricated 200
 *    (reversal-impact, guarded-edit). Each now does a tenant-scoped existence read first -> 404.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { sqlAsTenant } from "./helpers/engine-harness.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "8c000000-0000-4000-8000-0000000007a1";
const OTHER_TENANT = "8c000000-0000-4000-8000-0000000007b2";
const ACTOR = "8c000000-0000-4000-8000-0000000007c3";
const INSTANCE = randomUUID();
const TASK = randomUUID();
const INVALID_FIELDS = { id: "x".repeat(5000), amount: -1, email: "not-an-email", date: "31-31-2026" };

const hdr = (tenant = TENANT) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles: ["workflow_admin", "super_admin"], sid: "s-w8c" }, SECRET, 3600)}`,
});

let app: FastifyInstance;

async function wipe(): Promise<void> {
  await sqlAsTenant(TENANT, sql`DELETE FROM workflow.task_sla_pauses WHERE tenant_id = ${TENANT}`);
  await sqlAsTenant(TENANT, sql`DELETE FROM workflow.tasks WHERE tenant_id = ${TENANT}`);
  await sqlAsTenant(TENANT, sql`DELETE FROM workflow.instance_finalizations WHERE tenant_id = ${TENANT}`);
  await sqlAsTenant(TENANT, sql`DELETE FROM workflow.instances WHERE tenant_id = ${TENANT}`);
}

beforeAll(async () => {
  app = await buildApp();
  await wipe();
  await sqlAsTenant(TENANT, sql`INSERT INTO workflow.instances (id, tenant_id, name, status, created_by, updated_by)
    VALUES (${INSTANCE}, ${TENANT}, 'W8C inst', 'active', ${ACTOR}, ${ACTOR})`);
  await sqlAsTenant(TENANT, sql`INSERT INTO workflow.tasks (id, tenant_id, instance_id, name, status, role_ref, due_at, created_by, updated_by)
    VALUES (${TASK}, ${TENANT}, ${INSTANCE}, 'W8C task', 'pending', 'officer', now() + interval '1 day', ${ACTOR}, ${ACTOR})`);
});

afterAll(async () => {
  await wipe().catch(() => undefined);
  await app.close();
  await sqlClient.end();
});

afterEach(() => vi.restoreAllMocks());

describe("POST /v1/workflow/nurture-rules: invalid body -> 400, not a ZodError 500", () => {
  for (const [name, payload] of [["empty body", {}], ["invalid fields", INVALID_FIELDS]] as const) {
    it(name, async () => {
      const res = await app.inject({ method: "POST", url: "/v1/workflow/nurture-rules", headers: hdr(), payload });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
    });
  }
});

const ROUTES = [
  { url: (id: string) => `/v1/workflow/instances/${id}/finalize`, real: INSTANCE, ok: 202 },
  { url: (id: string) => `/v1/workflow/instances/${id}/reversal-impact`, real: INSTANCE, ok: 200 },
  { url: (id: string) => `/v1/workflow/instances/${id}/guarded-edit`, real: INSTANCE, ok: 200 },
  { url: (id: string) => `/v1/workflow/tasks/${id}/sla/pause`, real: TASK, ok: 202 },
  { url: (id: string) => `/v1/workflow/tasks/${id}/sla/resume`, real: TASK, ok: 202 },
];

describe("instance / task commands on an unknown id -> 404, nothing published", () => {
  for (const r of ROUTES) {
    const label = `POST ${r.url(":id")}`;
    it(`${label}: random id (empty and invalid-field bodies)`, async () => {
      const spy = vi.spyOn(queue, "publish");
      for (const payload of [{}, INVALID_FIELDS]) {
        const res = await app.inject({ method: "POST", url: r.url(randomUUID()), headers: hdr(), payload });
        expect(res.statusCode).toBe(404);
      }
      expect(spy).not.toHaveBeenCalled();
    });
    it(`${label}: another tenant's row -> 404`, async () => {
      const res = await app.inject({ method: "POST", url: r.url(r.real), headers: hdr(OTHER_TENANT), payload: {} });
      expect(res.statusCode).toBe(404);
    });
    it(`${label}: the real row -> ${r.ok}`, async () => {
      vi.spyOn(queue, "publish").mockResolvedValue("m");
      const res = await app.inject({ method: "POST", url: r.url(r.real), headers: hdr(), payload: {} });
      expect(res.statusCode).toBe(r.ok);
    });
  }
});
