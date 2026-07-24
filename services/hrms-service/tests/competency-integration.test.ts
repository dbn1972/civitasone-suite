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
import { registerCompetencyConsumers } from "../src/modules/competency/consumer.js";
import * as repo from "../src/modules/competency/repo.js";
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
    expect(res.statusCode).toBe(201);
    frameworkId = res.json().id;

    res = await app.inject({ method: "POST", url: `/v1/hrms/competency/frameworks/${frameworkId}/competencies`, headers: auth(tok(HR)),
      payload: { code: CODE_FIRE, name: "Fire Safety", maxLevel: 5, certifiedLevel: 4 } });
    expect(res.statusCode).toBe(201);
    compFire = res.json().id;
    res = await app.inject({ method: "POST", url: `/v1/hrms/competency/frameworks/${frameworkId}/competencies`, headers: auth(tok(HR)),
      payload: { code: CODE_LAW, name: "Legal Drafting", maxLevel: 5, certifiedLevel: 3 } });
    expect(res.statusCode).toBe(201);
    compLaw = res.json().id;
  });

  it("sets role requirements and returns them", async () => {
    for (const [cid, lvl] of [[compFire, 3], [compLaw, 4]] as const) {
      const res = await app.inject({ method: "POST", url: "/v1/hrms/competency/role-requirements", headers: auth(tok(HR)),
        payload: { roleCode: ROLE, competencyId: cid, requiredLevel: lvl } });
      expect(res.statusCode).toBe(201);
    }
    const res = await app.inject({ method: "GET", url: `/v1/hrms/competency/roles/${ROLE}/requirements`, headers: bare(tok(HR)) });
    expect(res.json().length).toBe(2);
  });

  it("records a manual held competency in the employee profile", async () => {
    const res = await app.inject({ method: "PUT", url: `/v1/hrms/competency/employees/${EMP}/competencies`, headers: auth(tok(HR)),
      payload: { competencyId: compLaw, currentLevel: 2, source: "manual" } });
    expect(res.statusCode).toBe(200);
    const prof = await app.inject({ method: "GET", url: `/v1/hrms/competency/employees/${EMP}/profile`, headers: bare(tok(HR)) });
    expect(prof.json().length).toBe(1);
  });
});

describe("gap analysis", () => {
  it("reports gaps vs role requirements (missing + under-level)", async () => {
    const res = await app.inject({ method: "GET",
      url: `/v1/hrms/competency/gap-analysis?employeeId=${EMP}&roleCode=${ROLE}`, headers: bare(tok(HR)) });
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
    expect(res.statusCode).toBe(404);
  });
  it("404s a role requirement for a missing competency", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/hrms/competency/role-requirements", headers: auth(tok(HR)),
      payload: { roleCode: ROLE, competencyId: randomUUID(), requiredLevel: 2 } });
    expect(res.statusCode).toBe(404);
  });
  it("404s setting a held level for a missing competency", async () => {
    const res = await app.inject({ method: "PUT", url: `/v1/hrms/competency/employees/${EMP}/competencies`, headers: auth(tok(HR)),
      payload: { competencyId: randomUUID(), currentLevel: 2 } });
    expect(res.statusCode).toBe(404);
  });
  it("403s a non-HR actor creating a framework", async () => {
    const empTok = signToken({ sub: EMP, tid: TENANT, roles: ["employee"], sid: "s" }, SECRET, 3600);
    const res = await app.inject({ method: "POST", url: "/v1/hrms/competency/frameworks",
      headers: { authorization: `Bearer ${empTok}`, "content-type": "application/json" }, payload: { name: "Nope" } });
    expect(res.statusCode).toBe(403);
  });
});
