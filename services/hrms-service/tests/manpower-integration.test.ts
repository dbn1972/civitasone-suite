/**
 * Manpower Planning & Recruitment Requisition — integration tests (SVC-003).
 *
 * Through the real Fastify app + real Postgres (FORCE RLS role), exercises:
 *   • plan lifecycle draft → submit → approve
 *   • maker-checker on approval (creator blocked, different checker allowed)
 *   • a recruitment requisition GENERATED on approval and EMITTED to the
 *     existing recruitment flow via the transactional outbox (hrms.job.create)
 *   • advertisement linkage
 *   • the fill-loop: a hrms.recruitment.position_filled event bumps the plan's
 *     filled_strength (shrinking the computed vacancy) and the requisition's
 *     filled_count — closing the plan → requisition → hire loop.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { tenantStorage } from "@civitasone/db";
import { MemoryQueue } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { registerManpowerConsumers } from "../src/modules/manpower-planning/consumer.js";
import * as repo from "../src/modules/manpower-planning/repo.js";
import { EVENTS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
// Randomised per run so the suite is idempotent (the plan carries a UNIQUE
// (tenant, unit, cadre, year) constraint — a fixed tenant would collide on re-run).
const TENANT  = randomUUID();
const MAKER   = randomUUID();
const CHECKER = randomUUID();
const UNIT    = randomUUID();

function tok(actor: string) {
  return signToken({ sub: actor, tid: TENANT, roles: ["super_admin", "hr_admin"], sid: "s" }, SECRET, 3600);
}
const auth = (t: string) => ({ authorization: `Bearer ${t}`, "content-type": "application/json" });
const bare = (t: string) => ({ authorization: `Bearer ${t}` });

let app: FastifyInstance;
let planId: string;
let jobOpeningId: string;
let requisitionId: string;
const PLAN_YEAR = 2027;

beforeAll(async () => {
  app = await buildApp();

  // Maker creates a draft plan: required 30, sanctioned 20, filled 0 → vacancy 20.
  let res = await app.inject({ method: "POST", url: "/v1/hrms/manpower/plans", headers: auth(tok(MAKER)),
    payload: { planYear: PLAN_YEAR, unitId: UNIT, cadre: "Junior Engineer",
      requiredStrength: 30, sanctionedStrength: 20, filledStrength: 0 } });
  expect(res.statusCode).toBe(201);
  planId = res.json().id;

  // Submit for approval.
  res = await app.inject({ method: "POST", url: `/v1/hrms/manpower/plans/${planId}/submit`, headers: bare(tok(MAKER)) });
  expect(res.statusCode).toBe(200);
  expect(res.json().status).toBe("pending_approval");
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("computed vacancy", () => {
  it("exposes vacancy = sanctioned − filled on the plan detail", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/hrms/manpower/plans/${planId}`, headers: bare(tok(MAKER)) });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.vacancy).toBe(20);
    expect(d.deficitVsRequired).toBe(10);
  });
});

describe("maker-checker on approval + requisition emission", () => {
  it("rejects approval by the plan creator (maker == checker)", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/manpower/plans/${planId}/approve`, headers: auth(tok(MAKER)), payload: {} });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("MAKER_CHECKER");
  });

  it("approves via a different checker, generates a requisition and emits hrms.job.create", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/manpower/plans/${planId}/approve`,
      headers: auth(tok(CHECKER)), payload: { title: "JE Recruitment 2027" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("approved");
    expect(body.approvedBy).toBe(CHECKER);
    expect(body.vacancy).toBe(20);
    expect(body.requisition).toBeTruthy();
    expect(body.requisition.requestedVacancies).toBe(20);
    requisitionId = body.requisition.id;
    jobOpeningId = body.requisition.jobOpeningId;

    // The job-create command was written to the outbox for the recruitment flow.
    // (payload is stored as a JSON-string scalar in the jsonb column.)
    tenantStorage.enterWith({ tenantId: TENANT });
    const rows = await db.transaction((tx) =>
      tx.execute(sql`select event_type,
                            (payload #>> '{}')::jsonb ->> 'id'          as id,
                            (payload #>> '{}')::jsonb ->> 'vacancies'   as vacancies,
                            (payload #>> '{}')::jsonb ->> 'departmentId' as department_id
                       from _outbox.messages
                      where topic = 'hrms.job.create'
                        and tenant_id = ${TENANT}::uuid
                        and (payload #>> '{}')::jsonb ->> 'id' = ${jobOpeningId}`));
    expect(rows.length).toBe(1);
    const r = rows[0] as Record<string, unknown>;
    expect(r.event_type).toBe("hrms.job.create");
    expect(r.vacancies).toBe("20");
    expect(r.department_id).toBe(UNIT);
  });

  it("persists an auto-allocated reservation roster summing to the vacancy", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/hrms/manpower/plans/${planId}`, headers: bare(tok(CHECKER)) });
    const roster: Array<{ category: string; reservedCount: number }> = res.json().data.roster;
    expect(roster.length).toBe(6);
    const vertical = roster.filter((r) => r.category !== "PwD").reduce((s, r) => s + r.reservedCount, 0);
    expect(vertical).toBe(20);
  });

  it("re-approving an already-approved plan is a 409 INVALID_STATE", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/manpower/plans/${planId}/approve`, headers: auth(tok(CHECKER)), payload: {} });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
  });
});

describe("advertisement linkage", () => {
  it("attaches an advertisement reference and flips status to advertised", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/manpower/requisitions/${requisitionId}/advertise`,
      headers: auth(tok(CHECKER)), payload: { advertisementRef: "ADVT/2027/JE/001" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("advertised");
    expect(res.json().advertisementRef).toBe("ADVT/2027/JE/001");
  });
});

describe("fill-loop: position_filled event updates the plan", () => {
  it("bumps requisition filled_count and plan filled_strength on a hire", async () => {
    // A separate in-memory queue with the manpower consumer registered, mirroring
    // how the worker wires it. The consumer reads/writes the real DB.
    const q = new MemoryQueue();
    registerManpowerConsumers(q);
    await q.start();

    await q.publish(EVENTS.positionFilled, {
      messageId: randomUUID(), type: EVENTS.positionFilled,
      tenantId: TENANT, actorId: CHECKER, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { jobOpeningId, employeeId: randomUUID(), tenantId: TENANT },
    });
    // allow the async handler to settle
    await new Promise<void>((r) => setTimeout(r, 300));
    await q.stop();

    tenantStorage.enterWith({ tenantId: TENANT });
    const plan = await repo.getPlan(TENANT, planId);
    expect(plan!.filledStrength).toBe(1);

    const reqs = await repo.listRequisitions(TENANT, planId);
    expect(reqs[0].filledCount).toBe(1);

    // Computed vacancy shrank from 20 to 19.
    const res = await app.inject({ method: "GET", url: `/v1/hrms/manpower/plans/${planId}`, headers: bare(tok(CHECKER)) });
    expect(res.json().data.vacancy).toBe(19);
  });

  it("is idempotent — a duplicate delivery does not double-count", async () => {
    const q = new MemoryQueue();
    registerManpowerConsumers(q);
    await q.start();
    const messageId = randomUUID();
    const evt = {
      messageId, type: EVENTS.positionFilled,
      tenantId: TENANT, actorId: CHECKER, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { jobOpeningId, employeeId: randomUUID(), tenantId: TENANT },
    };
    await q.publish(EVENTS.positionFilled, evt);
    await q.publish(EVENTS.positionFilled, evt); // same messageId → deduped by inbox
    await new Promise<void>((r) => setTimeout(r, 300));
    await q.stop();

    tenantStorage.enterWith({ tenantId: TENANT });
    const plan = await repo.getPlan(TENANT, planId);
    expect(plan!.filledStrength).toBe(2); // +1 from the pair, not +2
  });
});
