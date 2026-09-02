/**
 * SVC-099 Enterprise risk & control register — audit-service.
 *
 * Covers:
 *  1. Pure domain: residual scoring, review-cadence date math, maker-checker.
 *  2. Control test → control effectiveness is recomputed server-side.
 *  3. Risk acceptance maker-checker: the requester cannot approve their own
 *     acceptance; a different authority approves it.
 *  4. Periodic review writes a review row with a computed next_review_date.
 *  5. RLS cross-tenant isolation on risk_acceptances.
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
import {
  riskControls, riskAcceptances, riskReviews,
} from "../src/modules/risk-register/schema.js";
import { auditRisks } from "../src/modules/risk/schema.js";
import { registerRiskRegisterConsumers } from "../src/modules/risk-register/consumer.js";
import { COMMANDS } from "../src/topics.js";
import {
  computeResidualScore, computeNextReviewDate, isReviewDue, assertDifferentActor,
} from "../src/modules/risk-register/domain.js";

function wire(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((t: string, h: Handler) => raw(t, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
  return q;
}

const DAY = 24 * 60 * 60 * 1000;

// ── 1. pure domain ──────────────────────────────────────────────────────────
describe("risk-register domain (pure)", () => {
  it("residual score reduces inherent by control effectiveness (clamped >= 1)", () => {
    // possible x major = 12 inherent; effective → round(12*0.3)=4
    expect(computeResidualScore("possible", "major", "effective")).toBe(4);
    // not_tested → no reduction
    expect(computeResidualScore("possible", "major", "not_tested")).toBe(12);
    // partial → round(12*0.6)=7
    expect(computeResidualScore("possible", "major", "partial")).toBe(7);
    // rare x negligible = 1; effective → clamp to 1
    expect(computeResidualScore("rare", "negligible", "effective")).toBe(1);
  });
  it("rejects an unknown effectiveness", () => {
    // @ts-expect-error deliberate invalid input
    expect(() => computeResidualScore("possible", "major", "bogus")).toThrow(/INVALID_EFFECTIVENESS/);
  });
  it("computes the next review date by cadence", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    expect(computeNextReviewDate(from, "monthly").getTime()).toBe(from.getTime() + 30 * DAY);
    expect(computeNextReviewDate(from, "annual").getTime()).toBe(from.getTime() + 365 * DAY);
  });
  it("isReviewDue reflects the date", () => {
    const d = new Date("2026-01-01T00:00:00.000Z");
    expect(isReviewDue(d, new Date("2026-02-01T00:00:00.000Z"))).toBe(true);
    expect(isReviewDue(d, new Date("2025-12-01T00:00:00.000Z"))).toBe(false);
  });
  it("acceptance maker-checker guard", () => {
    expect(() => assertDifferentActor("a", "a")).toThrow(/MAKER_CHECKER_VIOLATION/);
    expect(() => assertDifferentActor("a", "b")).not.toThrow();
  });
});

// ── integration ─────────────────────────────────────────────────────────────
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const REQUESTER = randomUUID();
const APPROVER = randomUUID();
const RISK_ID = randomUUID();
const CONTROL_1 = randomUUID();
const ACCEPT_1 = randomUUID();
const REVIEW_1 = randomUUID();
const HIGH_RISK_ID = randomUUID();
const HIGH_CONTROL = randomUUID();
const HIGH_ACCEPT = randomUUID();

// risk.audit_risks and risk.risk_acceptances are case-of-record tables:
// migration 0027 added BEFORE DELETE OR TRUNCATE triggers that
// unconditionally reject both, so neither is wiped here (riskReviews and
// riskControls are not guarded tables and are still cleaned up normally).
// TENANT_A/TENANT_B and every entity id above are already randomUUID()
// per test run, so leftover rows across runs are harmless and never collide.
async function wipe(t: string): Promise<void> {
  await runWithTenant(t, () => db.transaction(async (tx) => {
    await tx.delete(riskReviews).where(eq(riskReviews.tenantId, t));
    await tx.delete(riskControls).where(eq(riskControls.tenantId, t));
  }));
}

// Seed a real risk row so acceptance proposals can compute an authoritative
// residual score from the risk's stored likelihood/impact.
async function seedRisk(
  t: string, id: string, riskCode: string, likelihood: string, impact: string, riskScore: number,
): Promise<void> {
  await runWithTenant(t, () => db.transaction((tx) => tx.insert(auditRisks).values({
    id, tenantId: t, riskCode, title: riskCode, likelihood, impact, riskScore,
    createdBy: REQUESTER, updatedBy: REQUESTER,
  })));
}

async function pump(q: Queue, topic: string, actorId: string, tenantId: string, payload: Record<string, unknown>) {
  await q.publish(topic, {
    messageId: randomUUID(), type: topic, tenantId, actorId,
    correlationId: "c", schemaVersion: "1.0", payload: { tenantId, ...payload },
  });
  await new Promise<void>((r) => setTimeout(r, 200));
}

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
function token(roles: string[], tenantId: string, actorId: string) {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-1" }, SECRET, 3600);
}

describe("risk register — controls, acceptance maker-checker, review", () => {
  let q: Queue;
  let app: FastifyInstance;
  beforeAll(async () => {
    await wipe(TENANT_A); await wipe(TENANT_B);
    // possible x major = 12 inherent; almost_certain x catastrophic = 25 inherent
    await seedRisk(TENANT_A, RISK_ID, "R-1", "possible", "major", 12);
    await seedRisk(TENANT_A, HIGH_RISK_ID, "R-HIGH", "almost_certain", "catastrophic", 25);
    app = await buildApp();
    q = wire(new MemoryQueue());
    registerRiskRegisterConsumers(q);
    await q.start();
  });
  afterAll(async () => {
    await q.stop();
    await wipe(TENANT_A); await wipe(TENANT_B);
    await app.close();
    await sqlClient.end();
  });

  it("route → command coverage: every register endpoint accepts (202) and lists return (200)", async () => {
    const h = { authorization: `Bearer ${token(["audit_officer"], TENANT_A, REQUESTER)}`, "content-type": "application/json" };
    const ha = { authorization: `Bearer ${token(["audit_admin"], TENANT_A, APPROVER)}`, "content-type": "application/json" };
    const post = (url: string, payload: unknown, headers = h) => app.inject({ method: "POST", url, headers, payload });
    const get = (url: string) => app.inject({ method: "GET", url, headers: h });
    expect((await post("/v1/audit/risk-controls", { riskId: RISK_ID, controlCode: "RC-1", description: "d" })).statusCode).toBe(202);
    expect((await post(`/v1/audit/risk-controls/${randomUUID()}/tests`, { result: "pass" })).statusCode).toBe(202);
    expect((await post("/v1/audit/risk-incidents", { title: "t", description: "d", severity: "major" })).statusCode).toBe(202);
    expect((await post("/v1/audit/risk-mitigations", { riskId: RISK_ID, action: "a" })).statusCode).toBe(202);
    expect((await post("/v1/audit/risk-acceptances", { riskId: RISK_ID, rationale: "r", residualScore: 5 })).statusCode).toBe(202);
    expect((await app.inject({ method: "PATCH", url: `/v1/audit/risk-acceptances/${randomUUID()}/decision`, headers: ha, payload: { decision: "approved" } })).statusCode).toBe(202);
    expect((await post("/v1/audit/risk-reviews", { riskId: RISK_ID, outcome: "unchanged", cadence: "quarterly" })).statusCode).toBe(202);
    for (const url of [
      `/v1/audit/risks/${RISK_ID}/controls`, "/v1/audit/risk-incidents",
      `/v1/audit/risks/${RISK_ID}/mitigations`, `/v1/audit/risks/${RISK_ID}/acceptances`,
      `/v1/audit/risks/${RISK_ID}/reviews`,
    ]) expect((await get(url)).statusCode).toBe(200);
  });

  it("403 when an ordinary audit role tries to decide an acceptance", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/audit/risk-acceptances/${randomUUID()}/decision`,
      headers: { authorization: `Bearer ${token(["audit_officer"], TENANT_A, REQUESTER)}`, "content-type": "application/json" },
      payload: { decision: "approved" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("a control test updates the control's effectiveness server-side", async () => {
    await pump(q, COMMANDS.riskControlCreate, REQUESTER, TENANT_A, { id: CONTROL_1, riskId: RISK_ID, controlCode: "C-1", description: "segregation of duties", controlType: "preventive" });
    await pump(q, COMMANDS.riskControlTest, REQUESTER, TENANT_A, { id: randomUUID(), controlId: CONTROL_1, result: "pass" });
    const rows = await runWithTenant(TENANT_A, () => db.transaction((tx) => tx.select().from(riskControls).where(eq(riskControls.id, CONTROL_1))));
    expect(rows[0]!.effectiveness).toBe("effective");
    expect(rows[0]!.version).toBe(2);
  });

  it("MAKER-CHECKER: requester cannot approve their own risk acceptance; a different authority can", async () => {
    await pump(q, COMMANDS.riskAcceptancePropose, REQUESTER, TENANT_A, { id: ACCEPT_1, riskId: RISK_ID, rationale: "cost of control exceeds exposure", residualScore: 6 });
    // requester tries to approve → rejected by guard (stays proposed)
    await pump(q, COMMANDS.riskAcceptanceDecide, REQUESTER, TENANT_A, { acceptanceId: ACCEPT_1, decision: "approved" });
    let rows = await runWithTenant(TENANT_A, () => db.transaction((tx) => tx.select().from(riskAcceptances).where(eq(riskAcceptances.id, ACCEPT_1))));
    expect(rows[0]!.status).toBe("proposed");
    expect(rows[0]!.decidedBy).toBeNull();
    // different authority approves
    await pump(q, COMMANDS.riskAcceptanceDecide, APPROVER, TENANT_A, { acceptanceId: ACCEPT_1, decision: "approved" });
    rows = await runWithTenant(TENANT_A, () => db.transaction((tx) => tx.select().from(riskAcceptances).where(eq(riskAcceptances.id, ACCEPT_1))));
    expect(rows[0]!.status).toBe("approved");
    expect(rows[0]!.decidedBy).toBe(APPROVER);
  });

  it("residualScore is server-computed from the risk + controls, NOT the client value", async () => {
    // A high-inherent risk (almost_certain x catastrophic = 25) whose only control
    // tests INEFFECTIVE (no reduction) → authoritative residual must stay 25.
    await pump(q, COMMANDS.riskControlCreate, REQUESTER, TENANT_A, { id: HIGH_CONTROL, riskId: HIGH_RISK_ID, controlCode: "C-HIGH", description: "weak review", controlType: "detective" });
    await pump(q, COMMANDS.riskControlTest, REQUESTER, TENANT_A, { id: randomUUID(), controlId: HIGH_CONTROL, result: "fail" });
    // Maker proposes acceptance self-declaring a bogus low residual score of 1.
    await pump(q, COMMANDS.riskAcceptancePropose, REQUESTER, TENANT_A, { id: HIGH_ACCEPT, riskId: HIGH_RISK_ID, rationale: "gaming the residual", residualScore: 1 });
    const rows = await runWithTenant(TENANT_A, () => db.transaction((tx) => tx.select().from(riskAcceptances).where(eq(riskAcceptances.id, HIGH_ACCEPT))));
    const expected = computeResidualScore("almost_certain", "catastrophic", "ineffective");
    expect(expected).toBe(25);
    // The persisted value is the SERVER-computed 25, never the client's 1.
    expect(rows[0]!.residualScore).toBe(expected);
    expect(rows[0]!.residualScore).not.toBe(1);
  });

  it("a periodic review records a row with a computed next_review_date", async () => {
    await pump(q, COMMANDS.riskReview, APPROVER, TENANT_A, { id: REVIEW_1, riskId: RISK_ID, outcome: "unchanged", cadence: "quarterly" });
    const rows = await runWithTenant(TENANT_A, () => db.transaction((tx) => tx.select().from(riskReviews).where(eq(riskReviews.id, REVIEW_1))));
    expect(rows[0]!.outcome).toBe("unchanged");
    expect(rows[0]!.nextReviewDate).toBeTruthy();
  });

  it("RLS: tenant B cannot see tenant A's acceptance", async () => {
    const rows = await runWithTenant(TENANT_B, () => db.transaction((tx) => tx.select().from(riskAcceptances).where(eq(riskAcceptances.id, ACCEPT_1))));
    expect(rows).toHaveLength(0);
  });
});
