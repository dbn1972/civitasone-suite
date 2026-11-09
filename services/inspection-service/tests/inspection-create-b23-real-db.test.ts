/**
 * UAT bundle 23 (onboarding gap): inspections could not be created through the API. Nothing in the
 * service inserted an execution.inspections row, so transition / submit-review / finalize / list had
 * nothing to work on. POST /v1/inspection/inspections now schedules one (state `scheduled`).
 * Real DB, service role (NOBYPASSRLS), seeds written under the tenant context.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { isNonRetryable, type Queue } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerExecutionConsumers } from "../src/modules/execution/consumer.js";
import { inspections } from "../src/modules/execution/schema.js";
import { regulatedEntities, inspectionTypes } from "../src/modules/universe/schema.js";
import { inspectionPlans } from "../src/modules/planning/schema.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const INSPECTOR = randomUUID();
const ids = { entity: randomUUID(), otherEntity: randomUUID(), type: randomUUID(), plan: randomUUID(), otherPlan: randomUUID() };
const planRow = (id: string, tenantId: string) => ({
  id, tenantId, name: "Annual Factory Safety Plan 2026-27", periodStart: "2026-04-01", periodEnd: "2027-03-31",
  entityIds: [], createdBy: ACTOR, updatedBy: ACTOR,
});

const bearer = (roles: string[], tenantId = TENANT) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenantId, roles, sid: "s-b23" }, SECRET, 3600)}`,
});
const asTenant = <T>(t: string, fn: Parameters<typeof db.transaction>[0]) => runWithTenant(t, () => db.transaction(fn)) as Promise<T>;

const handlers = new Map<string, (msg: unknown) => Promise<void>>();
registerExecutionConsumers({
  subscribe: (t: string, h: (m: unknown) => Promise<void>) => { handlers.set(t, h); },
} as unknown as Queue);
const deliver = (msg: { tenantId: string }) => runWithTenant(msg.tenantId, () => handlers.get(COMMANDS.inspectionCreate)!(msg));

let app: FastifyInstance;
const entityRow = (id: string, tenantId: string, regNo: string) => ({
  id, tenantId, registrationNo: regNo, entityType: "factory", name: "Pune Forgings Pvt Ltd", jurisdiction: "Pune",
  addressLine1: "Plot 14, MIDC Bhosari", city: "Pune", state: "Maharashtra", pincode: "411026",
  createdBy: ACTOR, updatedBy: ACTOR,
});

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await asTenant(TENANT, async (tx) => {
    await tx.insert(regulatedEntities).values(entityRow(ids.entity, TENANT, `MH-PUN-${ids.entity.slice(0, 6)}`));
    await tx.insert(inspectionTypes).values({
      id: ids.type, tenantId: TENANT, name: "Factory Safety Inspection", code: `FSI-${ids.type.slice(0, 6)}`,
      applicableEntityTypes: ["factory"], requiredCompetencies: [], defaultTemplateIds: [], createdBy: ACTOR, updatedBy: ACTOR,
    });
  });
  await asTenant(TENANT, async (tx) => { await tx.insert(inspectionPlans).values(planRow(ids.plan, TENANT)); });
  await asTenant(OTHER_TENANT, async (tx) => {
    await tx.insert(regulatedEntities).values(entityRow(ids.otherEntity, OTHER_TENANT, `MH-NSK-${ids.otherEntity.slice(0, 6)}`));
    await tx.insert(inspectionPlans).values(planRow(ids.otherPlan, OTHER_TENANT));
  });
});

afterAll(async () => {
  await asTenant(TENANT, async (tx) => {
    await tx.delete(inspections).where(eq(inspections.tenantId, TENANT));
    await tx.delete(inspectionPlans).where(eq(inspectionPlans.id, ids.plan));
    await tx.delete(inspectionTypes).where(eq(inspectionTypes.id, ids.type));
    await tx.delete(regulatedEntities).where(eq(regulatedEntities.id, ids.entity));
  }).catch(() => undefined);
  await asTenant(OTHER_TENANT, async (tx) => {
    await tx.delete(inspectionPlans).where(eq(inspectionPlans.id, ids.otherPlan));
    await tx.delete(regulatedEntities).where(eq(regulatedEntities.id, ids.otherEntity));
  }).catch(() => undefined);
  await app.close();
  await sqlClient.end();
});

describe("POST /v1/inspection/inspections", () => {
  it("is a role-gated 403 for an inspector (scheduling is a supervising-officer action)", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/inspection/inspections", headers: bearer(["inspector"]), payload: { entityId: ids.entity, inspectionTypeId: ids.type } });
    expect(res.statusCode).toBe(403);
  });

  it("404s an unknown entity, another tenant's entity and an unknown type; publishes nothing", async () => {
    const spy = vi.spyOn(queue, "publish");
    try {
      for (const payload of [
        { entityId: randomUUID(), inspectionTypeId: ids.type },
        { entityId: ids.otherEntity, inspectionTypeId: ids.type },
        { entityId: ids.entity, inspectionTypeId: randomUUID() },
        { entityId: ids.entity, inspectionTypeId: ids.type, planId: randomUUID() },
        { entityId: ids.entity, inspectionTypeId: ids.type, planId: ids.otherPlan }, // another tenant's plan
      ]) {
        const res = await app.inject({ method: "POST", url: "/v1/inspection/inspections", headers: bearer(["supervising_officer"]), payload });
        expect(res.statusCode).toBe(404);
      }
      expect(spy.mock.calls.filter(([topic]) => topic === COMMANDS.inspectionCreate)).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("400s a malformed body", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/inspection/inspections", headers: bearer(["supervising_officer"]), payload: { entityId: "nope", inspectionTypeId: ids.type } });
    expect(res.statusCode).toBe(400);
  });

  it("202 returns the new inspection id; the consumer creates it in state scheduled, readable via GET, with an outbox event; redelivery is a no-op", async () => {
    const spy = vi.spyOn(queue, "publish");
    let published: { messageId: string; tenantId: string; actorId: string; payload: { inspectionId: string } } | undefined;
    try {
      const res = await app.inject({
        method: "POST", url: "/v1/inspection/inspections", headers: bearer(["supervising_officer"]),
        payload: { entityId: ids.entity, inspectionTypeId: ids.type, planId: ids.plan, assignedInspectors: [INSPECTOR] },
      });
      expect(res.statusCode).toBe(202);
      published = spy.mock.calls.find(([topic]) => topic === COMMANDS.inspectionCreate)?.[1] as typeof published;
      expect(res.json().data).toMatchObject({ accepted: true, inspectionId: published!.payload.inspectionId });
    } finally {
      spy.mockRestore();
    }

    const id = published!.payload.inspectionId;
    await deliver(published!);
    // A second delivery with a NEW message id (not caught by the idempotency table) must not duplicate.
    await deliver({ ...published!, messageId: randomUUID() });

    const rows = await asTenant<Array<{ id: string; state: string; createdBy: string; version: number; planId: string | null }>>(TENANT, (tx) =>
      tx.select().from(inspections).where(and(eq(inspections.tenantId, TENANT), eq(inspections.id, id))));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: "scheduled", createdBy: ACTOR, version: 1, planId: ids.plan });

    const got = await app.inject({ method: "GET", url: `/v1/inspection/inspections/${id}`, headers: bearer(["supervising_officer"]) });
    expect(got.statusCode).toBe(200);
    expect(JSON.stringify(got.json())).toContain(id);

    const events = await sqlClient.unsafe(
      `SELECT topic FROM _outbox.messages WHERE tenant_id = $1 AND payload->>'inspectionId' = $2 OR (tenant_id = $1 AND payload->>'resourceId' = $2)`,
      [TENANT, id],
    ) as unknown as Array<{ topic: string }>;
    expect(events.map((e) => e.topic).sort()).toEqual(["audit.event.record", "inspection.inspection.scheduled"]);
  });

  it("consumer refuses (non-retryable) a command naming an entity from another tenant", async () => {
    let err: unknown;
    try {
      await deliver({
        messageId: randomUUID(), type: COMMANDS.inspectionCreate, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
        payload: { inspectionId: randomUUID(), entityId: ids.otherEntity, inspectionTypeId: ids.type, assignedInspectors: [] },
      } as never);
    } catch (e) { err = e; }
    expect(isNonRetryable(err)).toBe(true);
  });

  it("consumer refuses (non-retryable) a command naming another tenant's plan, and creates nothing", async () => {
    const inspectionId = randomUUID();
    let err: unknown;
    try {
      await deliver({
        messageId: randomUUID(), type: COMMANDS.inspectionCreate, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
        payload: { inspectionId, entityId: ids.entity, inspectionTypeId: ids.type, planId: ids.otherPlan, assignedInspectors: [] },
      } as never);
    } catch (e) { err = e; }
    expect(isNonRetryable(err)).toBe(true);
    const rows = await asTenant<unknown[]>(TENANT, (tx) => tx.select().from(inspections).where(eq(inspections.id, inspectionId)));
    expect(rows).toHaveLength(0);
  });
});
