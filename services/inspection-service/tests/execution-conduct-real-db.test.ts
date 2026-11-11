/**
 * Gap-fix wave (HANDOFF 5 item 7): an inspection execution can be scheduled against a plan, started
 * and completed through the API by the inspector it is assigned to. Real DB, service role (NOBYPASSRLS).
 *
 * Create (POST /inspections) already shipped in UAT bundle 23; this adds dedicated /start and /complete
 * (assigned-inspector rule, mandatory completion remarks) and a planId filter on the list, and proves the
 * whole chain scheduled -> in_progress -> completed with timestamps, history, events and role refusals.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { isNonRetryable, type Queue } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerExecutionConsumers } from "../src/modules/execution/consumer.js";
import { inspections, inspectionHistory } from "../src/modules/execution/schema.js";
import { regulatedEntities, inspectionTypes } from "../src/modules/universe/schema.js";
import { inspectionPlans } from "../src/modules/planning/schema.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const SUPERVISOR = randomUUID();
const ASSIGNED = randomUUID();
const STRANGER = randomUUID();
const REVIEWER = randomUUID();
const ADMIN = randomUUID();
const ids = { entity: randomUUID(), type: randomUUID(), plan: randomUUID(), otherPlan: randomUUID() };

const as = (sub: string, roles: string[], tenantId = TENANT) => ({
  authorization: `Bearer ${signToken({ sub, tid: tenantId, roles, sid: "s-gf" }, SECRET, 3600)}`,
});
const asTenant = <T>(t: string, fn: Parameters<typeof db.transaction>[0]) => runWithTenant(t, () => db.transaction(fn)) as Promise<T>;

const handlers = new Map<string, (msg: unknown) => Promise<void>>();
registerExecutionConsumers({
  subscribe: (t: string, h: (m: unknown) => Promise<void>) => { handlers.set(t, h); },
} as unknown as Queue);

// Capture what the routes publish and deliver it to the real consumers, like the worker would.
type Env = { messageId: string; type: string; tenantId: string; actorId: string; correlationId: string; payload: Record<string, unknown> };
const published: Env[] = [];
let app: FastifyInstance;
const deliverAll = async () => {
  for (const msg of published.splice(0)) {
    await runWithTenant(msg.tenantId, () => handlers.get(msg.type)!(msg));
  }
};
const row = async (id: string) => (await asTenant<Array<typeof inspections.$inferSelect>>(TENANT, (tx) =>
  tx.select().from(inspections).where(and(eq(inspections.tenantId, TENANT), eq(inspections.id, id)))))[0]!;

beforeAll(async () => {
  (queue as unknown as { publish: unknown }).publish = async (_topic: string, msg: Env) => { published.push(msg); };
  app = await buildApp();
  await app.ready();
  await asTenant(TENANT, async (tx) => {
    await tx.insert(regulatedEntities).values({
      id: ids.entity, tenantId: TENANT, registrationNo: `MH-GF-${ids.entity.slice(0, 6)}`, entityType: "factory", name: "Pune Forgings Pvt Ltd",
      jurisdiction: "Pune", addressLine1: "Plot 14, MIDC Bhosari", city: "Pune", state: "Maharashtra", pincode: "411026", createdBy: SUPERVISOR, updatedBy: SUPERVISOR,
    });
    await tx.insert(inspectionTypes).values({
      id: ids.type, tenantId: TENANT, name: "Factory Safety Inspection", code: `FSI-${ids.type.slice(0, 6)}`,
      applicableEntityTypes: ["factory"], requiredCompetencies: [], defaultTemplateIds: [], createdBy: SUPERVISOR, updatedBy: SUPERVISOR,
    });
    await tx.insert(inspectionPlans).values({ id: ids.plan, tenantId: TENANT, name: "Annual Factory Safety Plan 2026-27", periodStart: "2026-04-01", periodEnd: "2027-03-31", entityIds: [], createdBy: SUPERVISOR, updatedBy: SUPERVISOR });
    await tx.insert(inspectionPlans).values({ id: ids.otherPlan, tenantId: TENANT, name: "Second plan", periodStart: "2026-04-01", periodEnd: "2027-03-31", entityIds: [], createdBy: SUPERVISOR, updatedBy: SUPERVISOR });
  });
});

afterAll(async () => {
  await asTenant(TENANT, async (tx) => {
    await tx.delete(inspectionHistory).where(eq(inspectionHistory.tenantId, TENANT));
    await tx.delete(inspections).where(eq(inspections.tenantId, TENANT));
    await tx.delete(inspectionPlans).where(eq(inspectionPlans.tenantId, TENANT));
    await tx.delete(inspectionTypes).where(eq(inspectionTypes.id, ids.type));
    await tx.delete(regulatedEntities).where(eq(regulatedEntities.id, ids.entity));
  }).catch(() => undefined);
  await app.close();
  await sqlClient.end();
});

async function schedule(planId: string | undefined = ids.plan): Promise<string> {
  const res = await app.inject({
    method: "POST", url: "/v1/inspection/inspections", headers: as(SUPERVISOR, ["supervising_officer"]),
    payload: { entityId: ids.entity, inspectionTypeId: ids.type, ...(planId ? { planId } : {}), assignedInspectors: [ASSIGNED] },
  });
  expect(res.statusCode).toBe(202);
  await deliverAll();
  return res.json().data.inspectionId as string;
}
const post = (id: string, action: "start" | "complete", headers: Record<string, string>, payload?: unknown) =>
  app.inject({ method: "POST", url: `/v1/inspection/inspections/${id}/${action}`, headers, ...(payload === undefined ? {} : { payload }) });

describe("inspection execution: schedule against a plan -> start -> complete", () => {
  it("runs the whole chain, recording timestamps, history and events", async () => {
    const id = await schedule();
    expect(await row(id)).toMatchObject({ state: "scheduled", planId: ids.plan, startedAt: null, completedAt: null });

    const started = await post(id, "start", as(ASSIGNED, ["inspector"]));
    expect(started.statusCode).toBe(202);
    await deliverAll();
    const afterStart = await row(id);
    expect(afterStart.state).toBe("in_progress");
    expect(afterStart.startedAt).toBeInstanceOf(Date);
    expect(afterStart.updatedBy).toBe(ASSIGNED);

    const completed = await post(id, "complete", as(ASSIGNED, ["inspector"]), { remarks: "  All floors inspected; two minor findings noted.  " });
    expect(completed.statusCode).toBe(202);
    await deliverAll();
    const afterComplete = await row(id);
    expect(afterComplete.state).toBe("completed");
    expect(afterComplete.completedAt).toBeInstanceOf(Date);

    const hist = await asTenant<Array<typeof inspectionHistory.$inferSelect>>(TENANT, (tx) =>
      tx.select().from(inspectionHistory).where(eq(inspectionHistory.inspectionId, id)).orderBy(asc(inspectionHistory.transitionedAt)));
    expect(hist.map((h) => [h.previousState, h.newState, h.actorId])).toEqual([
      ["scheduled", "in_progress", ASSIGNED],
      ["in_progress", "completed", ASSIGNED],
    ]);
    expect(hist[1]!.remarks).toBe("All floors inspected; two minor findings noted.");

    const events = await sqlClient.unsafe(
      `SELECT topic FROM _outbox.messages WHERE tenant_id = $1 AND payload->>'inspectionId' = $2`, [TENANT, id],
    ) as unknown as Array<{ topic: string }>;
    expect(events.length).toBeGreaterThanOrEqual(2);
  });

  it("lists the executions linked to a plan (planId filter) and only those", async () => {
    const mine = await schedule(ids.plan);
    const other = await schedule(ids.otherPlan);
    const res = await app.inject({ method: "GET", url: `/v1/inspection/inspections?planId=${ids.plan}&pageSize=100`, headers: as(SUPERVISOR, ["supervising_officer"]) });
    expect(res.statusCode).toBe(200);
    const got = (res.json().data as Array<{ id: string; planId: string }>);
    expect(got.map((r) => r.id)).toContain(mine);
    expect(got.map((r) => r.id)).not.toContain(other);
    expect(new Set(got.map((r) => r.planId))).toEqual(new Set([ids.plan]));
    const bad = await app.inject({ method: "GET", url: "/v1/inspection/inspections?planId=nope", headers: as(SUPERVISOR, ["supervising_officer"]) });
    expect(bad.statusCode).toBe(400);
    // no filter: unchanged behaviour, both are listed
    const all = await app.inject({ method: "GET", url: "/v1/inspection/inspections?pageSize=200", headers: as(SUPERVISOR, ["supervising_officer"]) });
    const allIds = (all.json().data as Array<{ id: string }>).map((r) => r.id);
    expect(allIds).toEqual(expect.arrayContaining([mine, other]));
  });
});

describe("role and rule refusals", () => {
  it("officers do not conduct inspections: supervising and reviewing officers get 403 on start and complete", async () => {
    const id = await schedule();
    for (const [sub, roles] of [[SUPERVISOR, ["supervising_officer"]], [REVIEWER, ["reviewing_officer"]]] as const) {
      expect((await post(id, "start", as(sub, [...roles]))).statusCode).toBe(403);
      expect((await post(id, "complete", as(sub, [...roles]), { remarks: "done" })).statusCode).toBe(403);
    }
    expect(published).toHaveLength(0);
    expect((await row(id)).state).toBe("scheduled");
  });

  it("an inspector who is not assigned to the inspection gets 403 NOT_ASSIGNED", async () => {
    const id = await schedule();
    const res = await post(id, "start", as(STRANGER, ["inspector"]));
    expect(res.statusCode).toBe(403);
    expect(res.json().error?.code ?? res.json().code).toBe("NOT_ASSIGNED");
    expect(published).toHaveLength(0);
  });

  it("an admin may act for the inspector", async () => {
    const id = await schedule();
    expect((await post(id, "start", as(ADMIN, ["inspection_admin"]))).statusCode).toBe(202);
    await deliverAll();
    expect((await row(id)).state).toBe("in_progress");
  });

  it("wrong state is 409: complete before start, start twice, anything on a completed inspection", async () => {
    const id = await schedule();
    const insp = as(ASSIGNED, ["inspector"]);
    expect((await post(id, "complete", insp, { remarks: "too early" })).statusCode).toBe(409);
    expect((await post(id, "start", insp)).statusCode).toBe(202);
    await deliverAll();
    expect((await post(id, "start", insp)).statusCode).toBe(409);
    expect((await post(id, "complete", insp, { remarks: "finished" })).statusCode).toBe(202);
    await deliverAll();
    expect((await post(id, "complete", insp, { remarks: "again" })).statusCode).toBe(409);
    expect((await post(id, "start", insp)).statusCode).toBe(409);
  });

  it("completion remarks are mandatory: missing or blank is 400 and nothing is published", async () => {
    const id = await schedule();
    const insp = as(ASSIGNED, ["inspector"]);
    await post(id, "start", insp); await deliverAll();
    for (const payload of [undefined, {}, { remarks: "" }, { remarks: "   " }]) {
      expect((await post(id, "complete", insp, payload)).statusCode).toBe(400);
    }
    expect(published).toHaveLength(0);
  });

  it("404s an unknown inspection and another tenant's inspection", async () => {
    expect((await post(randomUUID(), "start", as(ASSIGNED, ["inspector"]))).statusCode).toBe(404);
    const id = await schedule();
    expect((await post(id, "start", as(ASSIGNED, ["inspector"], OTHER_TENANT))).statusCode).toBe(404);
  });
});

describe("existing behaviour is unchanged", () => {
  it("the generic /transition route still starts and completes (web hub uses it), and the consumer still refuses finalized", async () => {
    const id = await schedule();
    const insp = as(ASSIGNED, ["inspector"]);
    const t = (targetState: string) => app.inject({ method: "POST", url: `/v1/inspection/inspections/${id}/transition`, headers: insp, payload: { targetState } });
    expect((await t("in_progress")).statusCode).toBe(202);
    await deliverAll();
    expect((await row(id)).state).toBe("in_progress");
    expect((await t("completed")).statusCode).toBe(202);
    await deliverAll();
    expect((await row(id)).state).toBe("completed");
    expect((await t("finalized")).statusCode).toBe(202); // accepted by the route ...
    let err: unknown;
    try { await deliverAll(); } catch (e) { err = e; }
    expect(isNonRetryable(err)).toBe(true); // ... refused non-retryably by the consumer
    expect((await row(id)).state).toBe("completed");
  });

  it("the create command keeps its topic", () => {
    expect(COMMANDS.inspectionCreate).toBe("inspection.inspection.create");
  });
});
