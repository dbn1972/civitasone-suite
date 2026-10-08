/**
 * GAP-AUDIT-VIGILANCE-02 (DPDP) — audited reveal of confidential vigilance
 * fields (officer identity / charge text).
 *
 * Covers POST /v1/audit/vigilance/:id/reveal:
 *  - 401 with no bearer token.
 *  - 403 for a role outside the PII reveal set (finance_admin, dept_head).
 *  - 400 when the mandatory reason is missing / too short (zod boundary).
 *  - 200 for a PII reader role: returns the CLEAR field value AND writes a
 *    `vigilance_reveal` audit event into the outbox in the SAME transaction,
 *    carrying field + reason but NEVER the revealed value.
 *  - 404 for an unknown case id (and for another tenant's case — RLS).
 *
 * DB access is wrapped in runWithTenant(TENANT, () => db.transaction(...)) so
 * the tenant GUC is present before any query runs (FORCE RLS on vigilanceCases).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { vigilanceCases } from "../src/modules/vigilance/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

function token(roles: string[], tenantId: string, actorId: string) {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-1" }, SECRET, 3600);
}

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const ACTOR_A = randomUUID();
const CASE_A = randomUUID();
const OFFICER = "Inspector R. Kulkarni";
const CHARGES = "Misappropriation of departmental funds under CCS(CCA) Rule 14";

let app: FastifyInstance;

async function seedCase(): Promise<void> {
  await runWithTenant(TENANT_A, () => db.transaction((tx) => tx.insert(vigilanceCases).values({
    id: CASE_A,
    tenantId: TENANT_A,
    caseNo: `VIG-REV-${Date.now()}`,
    officer: OFFICER,
    charges: CHARGES,
    inquiryStatus: "preliminary_enquiry",
    outcome: "pending",
    createdBy: ACTOR_A,
    updatedBy: ACTOR_A,
  })));
}

describe("POST /v1/audit/vigilance/:id/reveal (audited DPDP reveal)", () => {
  beforeAll(async () => {
    app = await buildApp();
    await seedCase();
  });

  afterAll(async () => {
    await runWithTenant(TENANT_A, () => db.transaction((tx) =>
      tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT_A))));
    await app.close();
    await sqlClient.end();
  });

  it("401 without a bearer token", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/audit/vigilance/${CASE_A}/reveal`,
      headers: { "content-type": "application/json" },
      payload: { field: "officer", reason: "disciplinary review 2026" },
    });
    expect(res.statusCode).toBe(401);
  });

  it.each(["finance_admin", "dept_head", "employee"])("403 for non-PII role %s", async (role) => {
    const res = await app.inject({
      method: "POST", url: `/v1/audit/vigilance/${CASE_A}/reveal`,
      headers: { authorization: `Bearer ${token([role], TENANT_A, ACTOR_A)}`, "content-type": "application/json" },
      payload: { field: "officer", reason: "disciplinary review 2026" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("400 when the reason is missing or too short", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/audit/vigilance/${CASE_A}/reveal`,
      headers: { authorization: `Bearer ${token(["vigilance_officer"], TENANT_A, ACTOR_A)}`, "content-type": "application/json" },
      payload: { field: "officer", reason: "short" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("200 reveals the clear officer value and writes a vigilance_reveal audit event (no value in payload)", async () => {
    const reason = "DA inquiry file reference VIG-2026-07";
    const res = await app.inject({
      method: "POST", url: `/v1/audit/vigilance/${CASE_A}/reveal`,
      headers: { authorization: `Bearer ${token(["vigilance_officer"], TENANT_A, ACTOR_A)}`, "content-type": "application/json" },
      payload: { field: "officer", reason },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.value).toBe(OFFICER);

    // The audit event is in the outbox, scoped to this tenant.
    const rows = await runWithTenant(TENANT_A, () => db.transaction((tx) => tx.select().from(outboxMessages)
      .where(and(eq(outboxMessages.tenantId, TENANT_A), eq(outboxMessages.topic, "audit.event.record")))));
    const reveal = rows.find((r) => {
      const p = r.payload as { action?: string; resourceId?: string };
      return p.action === "vigilance_reveal" && p.resourceId === CASE_A;
    });
    expect(reveal).toBeDefined();
    const payload = reveal!.payload as { newValue?: { field?: string; reason?: string } };
    expect(payload.newValue?.field).toBe("officer");
    expect(payload.newValue?.reason).toBe(reason);
    // DPDP: the clear value must never appear anywhere in the audit payload.
    expect(JSON.stringify(reveal!.payload)).not.toContain(OFFICER);
  });

  it("200 reveals the clear charges value", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/audit/vigilance/${CASE_A}/reveal`,
      headers: { authorization: `Bearer ${token(["audit_officer"], TENANT_A, ACTOR_A)}`, "content-type": "application/json" },
      payload: { field: "charges", reason: "appellate authority review request" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.value).toBe(CHARGES);
  });

  it("404 for an unknown case id", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/audit/vigilance/${randomUUID()}/reveal`,
      headers: { authorization: `Bearer ${token(["vigilance_officer"], TENANT_A, ACTOR_A)}`, "content-type": "application/json" },
      payload: { field: "officer", reason: "looking for a non-existent case" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("404 (RLS): tenant B cannot reveal tenant A's case", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/audit/vigilance/${CASE_A}/reveal`,
      headers: { authorization: `Bearer ${token(["vigilance_officer"], TENANT_B, randomUUID())}`, "content-type": "application/json" },
      payload: { field: "officer", reason: "cross-tenant reveal attempt" },
    });
    expect(res.statusCode).toBe(404);
  });
});
