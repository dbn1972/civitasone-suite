/**
 * Observation read model: severity round-trip, real amount / due date / audit
 * period / para, and persisted replies (previously replies was hard-coded []).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { auditObservations, auditObservationReplies } from "../src/modules/observation/schema.js";
import { auditPlans } from "../src/modules/plan/schema.js";
import { auditParas } from "../src/modules/para/schema.js";
import { mapSeverity } from "../src/modules/observation/queries.js";
import { queue } from "../src/shared/infra.js";
import type { MemoryQueue } from "@civitasone/queue";
import { registerObservationConsumers } from "../src/modules/observation/consumer.js";

// The POST routes publish onto the shared queue singleton; only worker.ts wires
// consumers in production, so this file subscribes them once (module scope:
// MemoryQueue accumulates handlers) and drains after each command.
registerObservationConsumers(queue);
const drain = () => (queue as unknown as MemoryQueue).drain();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const jwt = (tenantId: string, actorId: string) =>
  signToken({ sub: actorId, tid: tenantId, roles: ["audit_officer"], sid: "sess-1" }, SECRET, 3600);

const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const PLAN_ID = randomUUID();
const RICH_ID = randomUUID();
const ids = { critical: randomUUID(), high: randomUUID(), medium: randomUUID(), low: randomUUID() };

let app: FastifyInstance;

describe("mapSeverity round-trips with the web labels", () => {
  it("maps write-side risk levels to the labels the UI shows", () => {
    expect(mapSeverity("critical")).toBe("critical");
    expect(mapSeverity("high")).toBe("major"); // web: major === "High"
    expect(mapSeverity("medium")).toBe("minor"); // web: minor === "Medium"
    expect(mapSeverity("low")).toBe("observation"); // web: observation === "Low"
  });
  it("is idempotent for already-read-model values", () => {
    for (const s of ["critical", "major", "minor", "observation"] as const) expect(mapSeverity(s)).toBe(s);
  });
});

beforeAll(async () => {
  app = await buildApp();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(auditPlans).values({
      id: PLAN_ID, tenantId: TENANT, planNo: `PL-${Date.now()}`, title: "FY plan", area: "finance",
      periodFrom: "2025-04-01", periodTo: "2026-03-31", createdBy: ACTOR, updatedBy: ACTOR,
    });
    for (const [k, id] of Object.entries(ids)) {
      await tx.insert(auditObservations).values({
        id, tenantId: TENANT, obsNo: `OBS-SEV-${k}-${Date.now()}`, auditeeRef: "dept:x",
        finding: `finding ${k}`, riskLevel: k, createdBy: ACTOR, updatedBy: ACTOR,
      });
    }
    await tx.insert(auditObservations).values({
      id: RICH_ID, tenantId: TENANT, obsNo: `OBS-RICH-${Date.now()}`, planId: PLAN_ID, auditeeRef: "dept:finance",
      finding: "rich finding", riskLevel: "high", amountInvolvedMinor: 123456n, dueDate: "2026-12-31",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(auditParas).values({
      tenantId: TENANT, paraNo: "PARA-7", observationId: RICH_ID, deptRef: "dept:finance", body: "para body",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(auditObservationReplies).values({
      tenantId: TENANT, observationId: RICH_ID, replyText: "We have rectified this.", respondedByRef: "dept_head:42",
      decision: "accepted", createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

async function get(url: string, tenant = TENANT) {
  return app.inject({ method: "GET", url, headers: { authorization: `Bearer ${jwt(tenant, ACTOR)}` } });
}

describe("GET /v1/audit/observations (list)", () => {
  it("returns exact severity, amount, due date, audit period and para", async () => {
    const res = await get("/v1/audit/observations?limit=100");
    expect(res.statusCode).toBe(200);
    const rows = (res.json().data ?? res.json()) as Array<Record<string, unknown>>;
    const sev = (id: string) => rows.find((r) => r.id === id)?.severity;
    expect(sev(ids.critical)).toBe("critical");
    expect(sev(ids.high)).toBe("major");
    expect(sev(ids.medium)).toBe("minor");
    expect(sev(ids.low)).toBe("observation");
    const rich = rows.find((r) => r.id === RICH_ID)!;
    expect(rich.amount).toBe(123456);
    expect(rich.dueDate).toBe("2026-12-31");
    expect(rich.auditPeriod).toBe("2025-04-01 to 2026-03-31");
    expect(rich.para).toBe("PARA-7");
  });
});

describe("GET /v1/audit/observations/:id (detail)", () => {
  it("returns the persisted replies and the real fields", async () => {
    const res = await get(`/v1/audit/observations/${RICH_ID}`);
    expect(res.statusCode).toBe(200);
    const d = res.json().data ?? res.json();
    expect(d.severity).toBe("major");
    expect(d.amount).toBe(123456);
    expect(d.para).toBe("PARA-7");
    expect(d.replies).toHaveLength(1);
    expect(d.replies[0]).toMatchObject({ repliedBy: "dept_head:42", content: "We have rectified this.", acceptedByAuditor: true });
  });

  it("does not leak replies across tenants (404 for another tenant)", async () => {
    const res = await get(`/v1/audit/observations/${RICH_ID}`, OTHER_TENANT);
    expect(res.statusCode).toBe(404);
  });
});

describe("command path: create -> reply -> reject -> reply -> accept (real routes + consumers)", () => {
  const tok = (roles: string[]) => signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-chain" }, SECRET, 3600);
  const post = (url: string, roles: string[], payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url, headers: { authorization: `Bearer ${tok(roles)}` }, payload });

  it("persists dueDate/critical and stamps accept/reject on the latest reply", async () => {
    const created = await post("/v1/audit/observations", ["audit_officer"], {
      obsNo: `OBS-CHAIN-${Date.now()}`, auditeeRef: "dept:chain", finding: "chain finding",
      riskLevel: "critical", amountInvolvedMinor: "5000", dueDate: "2027-01-15",
    });
    expect(created.statusCode).toBe(202);
    const id = created.json().id as string;
    await drain();

    let res = await post(`/v1/audit/observations/${id}/reply`, ["dept_head"], { replyText: "first reply", respondedByRef: "dept_head:1" });
    expect(res.statusCode).toBe(202);
    await drain();
    res = await post(`/v1/audit/observations/${id}/review`, ["audit_admin"], { decision: "rejected", remarks: "insufficient" });
    expect(res.statusCode).toBe(202);
    await drain();
    res = await post(`/v1/audit/observations/${id}/reply`, ["dept_head"], { replyText: "second reply", respondedByRef: "dept_head:1" });
    expect(res.statusCode).toBe(202);
    await drain();
    res = await post(`/v1/audit/observations/${id}/review`, ["audit_admin"], { decision: "accepted" });
    expect(res.statusCode).toBe(202);
    await drain();

    const detail = await get(`/v1/audit/observations/${id}`);
    expect(detail.statusCode).toBe(200);
    const d = detail.json().data ?? detail.json();
    expect(d.severity).toBe("critical");
    expect(d.dueDate).toBe("2027-01-15");
    expect(d.amount).toBe(5000);
    expect(d.replies).toHaveLength(2);
    expect(d.replies[0]).toMatchObject({ content: "first reply", acceptedByAuditor: false });
    expect(d.replies[1]).toMatchObject({ content: "second reply", acceptedByAuditor: true });

    const list = await get("/v1/audit/observations?limit=50");
    const rows = (list.json().data ?? list.json()) as Array<Record<string, unknown>>;
    const row = rows.find((r) => r.id === id)!;
    expect(row.severity).toBe("critical");
    expect(row.dueDate).toBe("2027-01-15");
  });
});
