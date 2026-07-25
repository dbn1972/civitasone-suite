/**
 * SVC-096 Vigilance lifecycle — audit-service.
 *
 * Covers:
 *  1. Pure domain: stage transitions, screening/IO guards, maker-checker.
 *  2. RESTRICTED ACCESS: the confidential case FILE (GET /:id) is vigilance-only —
 *     an audit_officer is 403, a vigilance_officer is 200.
 *  3. Full intake → screen → assign-IO → evidence → findings → propose-action flow.
 *  4. Maker-checker: an action decided by the PROPOSER is rejected; a different
 *     authority approves it (and the case closes).
 *  5. RLS cross-tenant isolation for vigilance_cases + actions.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { signToken } from "@civitasone/auth";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { vigilanceCases, vigilanceActions, vigilanceEvidence } from "../src/modules/vigilance/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerVigilanceConsumers } from "../src/modules/vigilance/consumer.js";
import { COMMANDS } from "../src/topics.js";
import {
  assertStageTransition, assertCanScreen, assertCanAssignIo, assertDifferentActor,
} from "../src/modules/vigilance/domain.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
function token(roles: string[], tenantId: string, actorId: string) {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-1" }, SECRET, 3600);
}
function wire(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((t: string, h: Handler) => raw(t, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
  return q;
}

// ── 1. pure domain ──────────────────────────────────────────────────────────
describe("vigilance domain (pure)", () => {
  it("allows intake → screening but rejects intake → findings", () => {
    expect(() => assertStageTransition("intake", "screening")).not.toThrow();
    expect(() => assertStageTransition("intake", "findings")).toThrow(/INVALID_STAGE/);
  });
  it("screening only allowed from intake/screening", () => {
    expect(() => assertCanScreen("intake")).not.toThrow();
    expect(() => assertCanScreen("closed")).toThrow(/INVALID_STAGE/);
  });
  it("IO assignment requires admission", () => {
    expect(() => assertCanAssignIo("admitted")).not.toThrow();
    expect(() => assertCanAssignIo("pending")).toThrow(/NOT_ADMITTED/);
  });
  it("maker-checker rejects same actor, allows different", () => {
    expect(() => assertDifferentActor("a", "a")).toThrow(/MAKER_CHECKER_VIOLATION/);
    expect(() => assertDifferentActor("a", "b")).not.toThrow();
    expect(() => assertDifferentActor("a", "")).toThrow(/CHECKER_REQUIRED/);
  });
});

// ── integration ─────────────────────────────────────────────────────────────
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const IO = randomUUID();       // investigating officer / proposer
const AUTHORITY = randomUUID();// disciplinary authority / checker
const CASE_1 = randomUUID();
const ACTION_1 = randomUUID();
const EV_1 = randomUUID();
let app: FastifyInstance;

async function wipe(t: string): Promise<void> {
  await runWithTenant(t, () => db.transaction(async (tx) => {
    await tx.delete(vigilanceEvidence).where(eq(vigilanceEvidence.tenantId, t));
    await tx.delete(vigilanceActions).where(eq(vigilanceActions.tenantId, t));
    await tx.delete(vigilanceCases).where(eq(vigilanceCases.tenantId, t));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
  }));
}

async function pump(q: Queue, topic: string, actorId: string, tenantId: string, payload: Record<string, unknown>) {
  await q.publish(topic, {
    messageId: randomUUID(), type: topic, tenantId, actorId,
    correlationId: "c", schemaVersion: "1.0", payload: { tenantId, ...payload },
  });
  await new Promise<void>((r) => setTimeout(r, 200));
}

describe("vigilance lifecycle + restricted access + maker-checker", () => {
  beforeAll(async () => {
    app = await buildApp();
    await wipe(TENANT_A); await wipe(TENANT_B);

    const q = wire(new MemoryQueue());
    registerVigilanceConsumers(q);
    await q.start();
    await pump(q, COMMANDS.vigilanceIntake, IO, TENANT_A, { id: CASE_1, caseNo: "VIG-LC-1", officer: "Shri X", charges: "bribery", complaintSource: "anonymous" });
    await pump(q, COMMANDS.vigilanceScreen, IO, TENANT_A, { caseId: CASE_1, decision: "admitted" });
    await pump(q, COMMANDS.vigilanceAssignIo, AUTHORITY, TENANT_A, { caseId: CASE_1, assignedIo: "IO Sharma" });
    await pump(q, COMMANDS.vigilanceEvidence, IO, TENANT_A, { id: EV_1, caseId: CASE_1, kind: "document", description: "bank statement" });
    await pump(q, COMMANDS.vigilanceFindings, IO, TENANT_A, { caseId: CASE_1, findings: "charges substantiated" });
    await pump(q, COMMANDS.vigilanceProposeAction, IO, TENANT_A, { id: ACTION_1, caseId: CASE_1, recommendation: "impose major penalty", recommendedAction: "major_penalty" });
    await q.stop();
  });
  afterAll(async () => {
    await wipe(TENANT_A); await wipe(TENANT_B);
    await app.close(); await sqlClient.end();
  });

  it("the case advanced through the full lifecycle to action_recommended", async () => {
    const rows = await runWithTenant(TENANT_A, () => db.transaction((tx) => tx.select().from(vigilanceCases).where(eq(vigilanceCases.id, CASE_1))));
    const row = rows[0]!;
    expect(row.screeningStatus).toBe("admitted");
    expect(row.assignedIo).toBe("IO Sharma");
    expect(row.findings).toContain("substantiated");
    expect(row.stage).toBe("action_recommended");
  });

  it("RESTRICTED: an audit_officer cannot read the confidential case file (403)", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/audit/vigilance/${CASE_1}`,
      headers: { authorization: `Bearer ${token(["audit_officer"], TENANT_A, IO)}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("RESTRICTED: a vigilance_officer CAN read the confidential case file (200, with evidence + actions)", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/audit/vigilance/${CASE_1}`,
      headers: { authorization: `Bearer ${token(["vigilance_officer"], TENANT_A, IO)}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.findings).toContain("substantiated");
    expect(body.evidence.length).toBe(1);
    expect(body.actions.length).toBe(1);
  });

  it("MAKER-CHECKER: the proposer cannot approve their own action recommendation", async () => {
    const q = wire(new MemoryQueue());
    registerVigilanceConsumers(q); await q.start();
    // decided by IO (the proposer) → must NOT apply
    await pump(q, COMMANDS.vigilanceDecideAction, IO, TENANT_A, { actionId: ACTION_1, decision: "approved" });
    let rows = await runWithTenant(TENANT_A, () => db.transaction((tx) => tx.select().from(vigilanceActions).where(eq(vigilanceActions.id, ACTION_1))));
    expect(rows[0]!.status).toBe("proposed");
    expect(rows[0]!.decidedBy).toBeNull();

    // decided by a different disciplinary authority → applied, case closes
    await pump(q, COMMANDS.vigilanceDecideAction, AUTHORITY, TENANT_A, { actionId: ACTION_1, decision: "approved" });
    await q.stop();
    rows = await runWithTenant(TENANT_A, () => db.transaction((tx) => tx.select().from(vigilanceActions).where(eq(vigilanceActions.id, ACTION_1))));
    expect(rows[0]!.status).toBe("approved");
    expect(rows[0]!.decidedBy).toBe(AUTHORITY);
    const caseRows = await runWithTenant(TENANT_A, () => db.transaction((tx) => tx.select().from(vigilanceCases).where(eq(vigilanceCases.id, CASE_1))));
    expect(caseRows[0]!.stage).toBe("closed");
    expect(caseRows[0]!.outcome).toBe("action_taken");
  });

  it("RLS: tenant B sees neither the case (list) nor its file", async () => {
    const list = await app.inject({
      method: "GET", url: "/v1/audit/vigilance",
      headers: { authorization: `Bearer ${token(["vigilance_officer"], TENANT_B, randomUUID())}` },
    });
    expect(list.statusCode).toBe(200);
    expect((list.json().items as { id: string }[]).find((i) => i.id === CASE_1)).toBeUndefined();

    const file = await app.inject({
      method: "GET", url: `/v1/audit/vigilance/${CASE_1}`,
      headers: { authorization: `Bearer ${token(["vigilance_officer"], TENANT_B, randomUUID())}` },
    });
    expect(file.statusCode).toBe(404);
  });

  // ── route → command coverage (202 accepted; memory queue, no consumer) ─────
  it("all vigilance mutation endpoints accept (202) for vigilance roles", async () => {
    const h = { authorization: `Bearer ${token(["vigilance_officer"], TENANT_A, IO)}`, "content-type": "application/json" };
    const ha = { authorization: `Bearer ${token(["vigilance_admin"], TENANT_A, AUTHORITY)}`, "content-type": "application/json" };
    const cid = randomUUID();
    const post = (url: string, payload: unknown, headers = h) => app.inject({ method: "POST", url, headers, payload });
    const patch = (url: string, payload: unknown, headers = h) => app.inject({ method: "PATCH", url, headers, payload });
    expect((await post("/v1/audit/vigilance", { caseNo: "VIG-R-1", officer: "O", charges: "c" })).statusCode).toBe(202);
    expect((await patch(`/v1/audit/vigilance/${cid}/screen`, { decision: "admitted" })).statusCode).toBe(202);
    expect((await patch(`/v1/audit/vigilance/${cid}/assign-io`, { assignedIo: "IO" })).statusCode).toBe(202);
    expect((await post(`/v1/audit/vigilance/${cid}/evidence`, { description: "doc" })).statusCode).toBe(202);
    expect((await patch(`/v1/audit/vigilance/${cid}/findings`, { findings: "f" })).statusCode).toBe(202);
    expect((await post(`/v1/audit/vigilance/${cid}/actions`, { recommendation: "r", recommendedAction: "warning" })).statusCode).toBe(202);
    expect((await patch(`/v1/audit/vigilance/${cid}/actions/${randomUUID()}/decision`, { decision: "approved" }, ha)).statusCode).toBe(202);
  });

  it("403: a non-vigilance role cannot open a confidential intake", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/audit/vigilance",
      headers: { authorization: `Bearer ${token(["audit_officer"], TENANT_A, IO)}`, "content-type": "application/json" },
      payload: { caseNo: "X", officer: "O", charges: "c" },
    });
    expect(res.statusCode).toBe(403);
  });
});
