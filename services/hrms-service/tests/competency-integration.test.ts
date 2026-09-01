/**
 * SVC-124 competency & skill management — integration tests through the real
 * Fastify app + DB, PLUS the certificate→competency consumer.
 * Covers: framework + competency dictionary, role requirements, employee
 * profile, gap analysis, and the assessment.certificate.issued consumer that
 * raises an employee's held competency on certificate issuance.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { MemoryQueue } from "@civitasone/queue";
import { tenantStorage } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerF3_competency_Consumers } from "../src/modules/competency/f3-consumer.js";

// These routes answer 200/201 as soon as the write is QUEUED; the real database write
// happens in the F3 consumer, which buildApp() does NOT register (only worker.ts does).
// Without registering + draining it here the suite asserted only the optimistic HTTP
// response, so the consumer could crash on undefined locals and nothing would notice.
registerF3_competency_Consumers(queue);
async function drainF3() {
  await (queue as unknown as import("@civitasone/queue").MemoryQueue).drain();
}
function f3Dlq() {
  return (queue as unknown as import("@civitasone/queue").MemoryQueue).dlq;
}
import { registerCompetencyConsumers } from "../src/modules/competency/consumer.js";
import * as repo from "../src/modules/competency/repo.js";
import { frameworks, competencies, roleRequirements, employeeCompetencies } from "../src/modules/competency/schema.js";
import { db } from "../src/shared/db.js";
import { COMMANDS } from "../src/topics.js";
import { eq, and } from "drizzle-orm";
import { EVENTS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const HR  = "f2222222-0000-4000-8000-000000000001";
const EMP = "f3333333-0000-4000-8000-0000000000e1";
const ROLE = "TAX_INSPECTOR";
const uniq = Date.now().toString(36);
const CODE_FIRE = `FIRE-${uniq}`;
const CODE_LAW  = `LAW-${uniq}`;

function tok(actor: string) {
  return signToken({ sub: actor, tid: TENANT, roles: ["super_admin", "hr_admin"], sid: "s" }, SECRET, 3600);
}
const auth = (t: string) => ({ authorization: `Bearer ${t}`, "content-type": "application/json" });
const bare = (t: string) => ({ authorization: `Bearer ${t}` });

let app: FastifyInstance;
let frameworkId: string;
let compFire: string;
let compLaw: string;

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("framework, dictionary, role requirements", () => {
  it("creates a framework and two competencies", async () => {
    let res = await app.inject({ method: "POST", url: "/v1/hrms/competency/frameworks", headers: auth(tok(HR)),
      payload: { name: "Core Civil Service" } });
    await drainF3();
    expect(res.statusCode).toBe(201);
    frameworkId = res.json().id;

    res = await app.inject({ method: "POST", url: `/v1/hrms/competency/frameworks/${frameworkId}/competencies`, headers: auth(tok(HR)),
      payload: { code: CODE_FIRE, name: "Fire Safety", maxLevel: 5, certifiedLevel: 4 } });
    await drainF3();
    expect(res.statusCode).toBe(201);
    compFire = res.json().id;
    res = await app.inject({ method: "POST", url: `/v1/hrms/competency/frameworks/${frameworkId}/competencies`, headers: auth(tok(HR)),
      payload: { code: CODE_LAW, name: "Legal Drafting", maxLevel: 5, certifiedLevel: 3 } });
    await drainF3();
    expect(res.statusCode).toBe(201);
    compLaw = res.json().id;
  });

  it("sets role requirements and returns them", async () => {
    for (const [cid, lvl] of [[compFire, 3], [compLaw, 4]] as const) {
      const res = await app.inject({ method: "POST", url: "/v1/hrms/competency/role-requirements", headers: auth(tok(HR)),
        payload: { roleCode: ROLE, competencyId: cid, requiredLevel: lvl } });
    await drainF3();
      expect(res.statusCode).toBe(201);
    }
    const res = await app.inject({ method: "GET", url: `/v1/hrms/competency/roles/${ROLE}/requirements`, headers: bare(tok(HR)) });
    await drainF3();
    expect(res.json().length).toBe(2);
  });

  it("records a manual held competency in the employee profile", async () => {
    const res = await app.inject({ method: "PUT", url: `/v1/hrms/competency/employees/${EMP}/competencies`, headers: auth(tok(HR)),
      payload: { competencyId: compLaw, currentLevel: 2, source: "manual" } });
    await drainF3();
    expect(res.statusCode).toBe(200);
    const prof = await app.inject({ method: "GET", url: `/v1/hrms/competency/employees/${EMP}/profile`, headers: bare(tok(HR)) });
    await drainF3();
    expect(prof.json().length).toBe(1);
  });
});

describe("gap analysis", () => {
  it("reports gaps vs role requirements (missing + under-level)", async () => {
    const res = await app.inject({ method: "GET",
      url: `/v1/hrms/competency/gap-analysis?employeeId=${EMP}&roleCode=${ROLE}`, headers: bare(tok(HR)) });
    await drainF3();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.requiredCount).toBe(2);
    // FIRE required 3, held 0 -> gap 3; LAW required 4, held 2 -> gap 2. metCount 0.
    expect(body.metCount).toBe(0);
    expect(body.gapCount).toBe(2);
    const law = body.rows.find((r: any) => r.competencyId === compLaw);
    expect(law).toMatchObject({ requiredLevel: 4, heldLevel: 2, gap: 2, met: false });
  });
});

describe("certificate → competency consumer", () => {
  it("raises the held competency to the certified level on certificate issuance", async () => {
    const q = new MemoryQueue();
    registerCompetencyConsumers(q);
    await q.start();

    const msg = {
      messageId: randomUUID(), type: EVENTS.certificateIssued, tenantId: TENANT, actorId: HR,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { tenant_id: TENANT, employee_id: EMP, assessment_id: randomUUID(),
        certificate_no: `CERT-${uniq}`, competency_ref: CODE_FIRE },
    };
    await q.publish(EVENTS.certificateIssued, msg);
    await new Promise((r) => setTimeout(r, 200));
    await q.stop();

    tenantStorage.enterWith({ tenantId: TENANT });
    const held = await repo.listEmployeeCompetencies(TENANT, EMP);
    const fire = held.find((h) => h.competencyId === compFire);
    expect(fire).toBeTruthy();
    expect(fire!.currentLevel).toBe(4); // FIRE certifiedLevel = 4
    expect(fire!.source).toBe("assessment");
    expect(fire!.evidenceRef).toBe(`CERT-${uniq}`);
  });

  it("gap analysis now shows FIRE met after certification", async () => {
    const res = await app.inject({ method: "GET",
      url: `/v1/hrms/competency/gap-analysis?employeeId=${EMP}&roleCode=${ROLE}`, headers: bare(tok(HR)) });
    await drainF3();
    const body = res.json();
    const fire = body.rows.find((r: any) => r.competencyId === compFire);
    expect(fire.met).toBe(true); // held 4 >= required 3
    expect(body.metCount).toBe(1);
  });

  it("a duplicate delivery is idempotent (markProcessed)", async () => {
    const q = new MemoryQueue();
    registerCompetencyConsumers(q);
    await q.start();
    const messageId = randomUUID();
    const base = {
      messageId, type: EVENTS.certificateIssued, tenantId: TENANT, actorId: HR,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { tenant_id: TENANT, employee_id: EMP, assessment_id: randomUUID(),
        certificate_no: `CERT-DUP-${uniq}`, competency_ref: CODE_LAW },
    };
    await q.publish(EVENTS.certificateIssued, base);
    await new Promise((r) => setTimeout(r, 150));
    // Re-deliver the SAME messageId — must not change anything further.
    await q.publish(EVENTS.certificateIssued, base);
    await new Promise((r) => setTimeout(r, 150));
    await q.stop();

    tenantStorage.enterWith({ tenantId: TENANT });
    const held = await repo.listEmployeeCompetencies(TENANT, EMP);
    const law = held.find((h) => h.competencyId === compLaw);
    // LAW certifiedLevel is 3; manual was 2 → GREATEST keeps 3 (not regressed).
    expect(law!.currentLevel).toBe(3);
    expect(law!.evidenceRef).toBe(`CERT-DUP-${uniq}`);
  });

  it("is a no-op when the certificate carries no competency_ref", async () => {
    const q = new MemoryQueue();
    registerCompetencyConsumers(q);
    await q.start();
    tenantStorage.enterWith({ tenantId: TENANT });
    const before = (await repo.listEmployeeCompetencies(TENANT, EMP)).length;
    await q.publish(EVENTS.certificateIssued, {
      messageId: randomUUID(), type: EVENTS.certificateIssued, tenantId: TENANT, actorId: HR,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { tenant_id: TENANT, employee_id: EMP, assessment_id: randomUUID(), certificate_no: "C-NONE", competency_ref: null },
    });
    await new Promise((r) => setTimeout(r, 150));
    await q.stop();
    tenantStorage.enterWith({ tenantId: TENANT });
    expect((await repo.listEmployeeCompetencies(TENANT, EMP)).length).toBe(before);
  });

  it("is a no-op when competency_ref does not resolve to a known competency", async () => {
    const q = new MemoryQueue();
    registerCompetencyConsumers(q);
    await q.start();
    tenantStorage.enterWith({ tenantId: TENANT });
    const before = (await repo.listEmployeeCompetencies(TENANT, EMP)).length;
    await q.publish(EVENTS.certificateIssued, {
      messageId: randomUUID(), type: EVENTS.certificateIssued, tenantId: TENANT, actorId: HR,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { tenant_id: TENANT, employee_id: EMP, assessment_id: randomUUID(), certificate_no: "C-UNK", competency_ref: "NO-SUCH-CODE" },
    });
    await new Promise((r) => setTimeout(r, 150));
    await q.stop();
    tenantStorage.enterWith({ tenantId: TENANT });
    expect((await repo.listEmployeeCompetencies(TENANT, EMP)).length).toBe(before);
  });

  it("ignores a malformed event with no employee_id", async () => {
    const q = new MemoryQueue();
    registerCompetencyConsumers(q);
    await q.start();
    await q.publish(EVENTS.certificateIssued, {
      messageId: randomUUID(), type: EVENTS.certificateIssued, tenantId: TENANT, actorId: HR,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { tenant_id: TENANT, competency_ref: CODE_FIRE },
    });
    await new Promise((r) => setTimeout(r, 120));
    await q.stop();
    expect(true).toBe(true); // no throw
  });
});

describe("competency route guards", () => {
  it("404s adding a competency to a missing framework", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/competency/frameworks/${randomUUID()}/competencies`, headers: auth(tok(HR)),
      payload: { code: "X", name: "X" } });
    await drainF3();
    expect(res.statusCode).toBe(404);
  });
  it("404s a role requirement for a missing competency", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/hrms/competency/role-requirements", headers: auth(tok(HR)),
      payload: { roleCode: ROLE, competencyId: randomUUID(), requiredLevel: 2 } });
    await drainF3();
    expect(res.statusCode).toBe(404);
  });
  it("404s setting a held level for a missing competency", async () => {
    const res = await app.inject({ method: "PUT", url: `/v1/hrms/competency/employees/${EMP}/competencies`, headers: auth(tok(HR)),
      payload: { competencyId: randomUUID(), currentLevel: 2 } });
    await drainF3();
    expect(res.statusCode).toBe(404);
  });
  it("403s a non-HR actor creating a framework", async () => {
    const empTok = signToken({ sub: EMP, tid: TENANT, roles: ["employee"], sid: "s" }, SECRET, 3600);
    const res = await app.inject({ method: "POST", url: "/v1/hrms/competency/frameworks",
      headers: { authorization: `Bearer ${empTok}`, "content-type": "application/json" }, payload: { name: "Nope" } });
    await drainF3();
    expect(res.statusCode).toBe(403);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// F3 write-consumer regression tests.
//
// The routes above answer 200/201 the moment the command is queued, so a crash in
// the consumer is invisible to them. These tests drive the consumer directly — the
// only place the write actually happens. Before the fix, `competency_routes__1`
// threw on an undefined `cid` and `competency_routes__3` on an undefined `level`,
// both landing in the DLQ having written nothing.
// ─────────────────────────────────────────────────────────────────────────────
describe("F3 write consumer — competency", () => {
  const F_FRAMEWORK = randomUUID();
  const F_COMP = randomUUID();
  const F_EMP = randomUUID();
  const F_ROLE = `F3_ROLE_${uniq}`;

  async function publishF3(op: string, id: string, params: Record<string, unknown>, body: Record<string, unknown> = {}) {
    tenantStorage.enterWith({ tenantId: TENANT });
    await queue.publish(COMMANDS.f3RouteWrite, {
      messageId: randomUUID(),
      type: COMMANDS.f3RouteWrite,
      tenantId: TENANT,
      actorId: HR,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: { op, id, tenantId: TENANT, body, params, query: {} },
    });
    await drainF3();
  }

  beforeAll(() => { f3Dlq().length = 0; });

  it("competency_routes__0 — inserts the framework", async () => {
    tenantStorage.enterWith({ tenantId: TENANT });
    await publishF3("competency_routes__0", F_FRAMEWORK, {}, { name: "F3 Framework" });

    expect(f3Dlq()).toHaveLength(0);
    const rows = await db.transaction((tx) => tx.select().from(frameworks)
      .where(and(eq(frameworks.tenantId, TENANT), eq(frameworks.id, F_FRAMEWORK))));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("F3 Framework");
  });

  it("competency_routes__1 — inserts the competency under the :id framework, keyed by the returned id", async () => {
    tenantStorage.enterWith({ tenantId: TENANT });
    await publishF3("competency_routes__1", F_COMP, { id: F_FRAMEWORK },
      { code: `F3C-${uniq}`, name: "F3 Competency", maxLevel: 4, certifiedLevel: 2 });

    expect(f3Dlq()).toHaveLength(0);
    const rows = await db.transaction((tx) => tx.select().from(competencies)
      .where(and(eq(competencies.tenantId, TENANT), eq(competencies.id, F_COMP))));
    expect(rows).toHaveLength(1);
    // frameworkId must come from the :id path param, not from the message id.
    expect(rows[0]!.frameworkId).toBe(F_FRAMEWORK);
    expect(rows[0]!.maxLevel).toBe(4);
    expect(rows[0]!.certifiedLevel).toBe(2);
  });

  it("competency_routes__1 — reapplies the route's Zod defaults", async () => {
    tenantStorage.enterWith({ tenantId: TENANT });
    const cid = randomUUID();
    await publishF3("competency_routes__1", cid, { id: F_FRAMEWORK },
      { code: `F3D-${uniq}`, name: "F3 Defaults" });

    expect(f3Dlq()).toHaveLength(0);
    const rows = await db.transaction((tx) => tx.select().from(competencies)
      .where(and(eq(competencies.tenantId, TENANT), eq(competencies.id, cid))));
    expect(rows[0]!.category).toBe("general");
    expect(rows[0]!.maxLevel).toBe(5);
    expect(rows[0]!.certifiedLevel).toBe(3);
  });

  it("competency_routes__2 — upserts the role requirement", async () => {
    tenantStorage.enterWith({ tenantId: TENANT });
    await publishF3("competency_routes__2", randomUUID(), {},
      { roleCode: F_ROLE, competencyId: F_COMP, requiredLevel: 3 });

    expect(f3Dlq()).toHaveLength(0);
    const rows = await db.transaction((tx) => tx.select().from(roleRequirements)
      .where(and(eq(roleRequirements.tenantId, TENANT), eq(roleRequirements.roleCode, F_ROLE))));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.requiredLevel).toBe(3);
  });

  it("competency_routes__3 — clamps the held level to the competency ceiling", async () => {
    tenantStorage.enterWith({ tenantId: TENANT });
    // F_COMP has maxLevel 4; the route computes Math.min(body.currentLevel, comp.maxLevel).
    await publishF3("competency_routes__3", randomUUID(), { id: F_EMP },
      { competencyId: F_COMP, currentLevel: 9, source: "assessment" });

    expect(f3Dlq()).toHaveLength(0);
    const rows = await db.transaction((tx) => tx.select().from(employeeCompetencies)
      .where(and(eq(employeeCompetencies.tenantId, TENANT), eq(employeeCompetencies.employeeId, F_EMP))));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.currentLevel).toBe(4);
    expect(rows[0]!.competencyId).toBe(F_COMP);
    expect(rows[0]!.source).toBe("assessment");
  });

  it("competency_routes__3 — reapplies the route's Zod default for source", async () => {
    tenantStorage.enterWith({ tenantId: TENANT });
    const emp = randomUUID();
    await publishF3("competency_routes__3", randomUUID(), { id: emp },
      { competencyId: F_COMP, currentLevel: 2 });

    expect(f3Dlq()).toHaveLength(0);
    const rows = await db.transaction((tx) => tx.select().from(employeeCompetencies)
      .where(and(eq(employeeCompetencies.tenantId, TENANT), eq(employeeCompetencies.employeeId, emp))));
    expect(rows[0]!.currentLevel).toBe(2);
    expect(rows[0]!.source).toBe("manual");
  });
});
