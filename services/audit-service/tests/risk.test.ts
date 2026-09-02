/**
 * audit-service risk module tests
 *
 * Covers:
 *  1. Pure domain tests for computeRiskScore / riskBand (no DB).
 *  2. POST /v1/audit/risks route auth (401/403/202).
 *  3. POST /v1/audit/risks validation (400 on missing required field).
 *  4. riskCreate consumer integration — server-side score recomputation.
 *  5. riskUpdate consumer integration — version increment + field updates.
 *  6. Idempotency — republishing the same messageId does not duplicate rows.
 *
 * Test-harness fix: `new MemoryQueue()` used directly (not the `createQueue()`
 * factory) does NOT auto-wrap subscribed handlers with `withTenantConsumer`.
 * Production wiring (queue-service's `createQueue()`) decorates `subscribe()`
 * so every consumer handler runs inside `runWithTenant(msg.tenantId, ...)`,
 * which is what lets `db.transaction()` pick up the tenant GUC. Without this
 * wrapping, consumer writes/reads run with no RLS GUC set and every
 * insert/update fails its `WITH CHECK` under FORCE RLS. Mirrors the pattern
 * established in tests/para.test.ts.
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
import { auditRisks } from "../src/modules/risk/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerRiskConsumers } from "../src/modules/risk/consumer.js";
import { computeRiskScore, riskBand, HIGH_RISK_THRESHOLD } from "../src/modules/risk/domain.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
function token(roles: string[], tenantId: string, actorId: string) {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-1" }, SECRET, 3600);
}

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

// ───────────────────────────────────────────────────────────────────────────
// 1. Pure domain tests — no DB needed.
// ───────────────────────────────────────────────────────────────────────────
describe("risk domain — computeRiskScore (pure)", () => {
  it("rare x negligible = 1 x 1 = 1", () => {
    expect(computeRiskScore("rare", "negligible")).toBe(1);
  });

  it("almost_certain x catastrophic = 5 x 5 = 25", () => {
    expect(computeRiskScore("almost_certain", "catastrophic")).toBe(25);
  });

  it("possible x major = 3 x 4 = 12", () => {
    expect(computeRiskScore("possible", "major")).toBe(12);
  });

  it("likely x moderate = 4 x 3 = 12", () => {
    expect(computeRiskScore("likely", "moderate")).toBe(12);
  });

  it("unlikely x minor = 2 x 2 = 4", () => {
    expect(computeRiskScore("unlikely", "minor")).toBe(4);
  });

  it("throws DomainError for an unknown likelihood/impact", () => {
    // @ts-expect-error — deliberately passing an invalid ordinal to exercise the guard.
    expect(() => computeRiskScore("nonsense", "moderate")).toThrow(/INVALID_RISK_INPUT/);
  });
});

describe("risk domain — riskBand boundaries (pure)", () => {
  it("score >= 15 → critical", () => {
    expect(riskBand(15)).toBe("critical");
    expect(riskBand(25)).toBe("critical");
  });

  it("score >= 9 and < 15 → high", () => {
    expect(riskBand(9)).toBe("high");
    expect(riskBand(14)).toBe("high");
  });

  it("score >= 4 and < 9 → medium", () => {
    expect(riskBand(4)).toBe("medium");
    expect(riskBand(8)).toBe("medium");
  });

  it("score < 4 → low", () => {
    expect(riskBand(1)).toBe("low");
    expect(riskBand(3)).toBe("low");
  });

  it("HIGH_RISK_THRESHOLD is 12 and bands as high", () => {
    expect(HIGH_RISK_THRESHOLD).toBe(12);
    expect(riskBand(HIGH_RISK_THRESHOLD)).toBe("high");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Route + consumer integration
// ───────────────────────────────────────────────────────────────────────────
const TENANT = randomUUID();
const ACTOR = randomUUID();
const RISK_1 = randomUUID();
// Own id, not RISK_1: risk.audit_risks can no longer be wiped between
// describe blocks (migration 0027), and the "riskCreate" describe below
// already inserts RISK_1, so the "riskUpdate" describe seeds an
// independent row instead of reusing/resetting RISK_1.
const RISK_2 = randomUUID();
const MSG_CREATE_1 = randomUUID();
const MSG_UPDATE_1 = randomUUID();
const MSG_DUP = randomUUID();

// risk.audit_risks is a case-of-record table: migration 0027 added a BEFORE
// DELETE OR TRUNCATE trigger that unconditionally rejects both, so it is
// never wiped here. TENANT/RISK_* above are randomUUID()-scoped per test run
// instead, so leftover rows across runs are harmless and never collide.
async function wipe(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    for (const id of [MSG_CREATE_1, MSG_UPDATE_1, MSG_DUP]) {
      await tx.delete(processed).where(eq(processed.messageId, id));
    }
  }));
}

let app: FastifyInstance;

describe("POST /v1/audit/risks — route auth + validation", () => {
  beforeAll(async () => {
    app = await buildApp();
    await wipe();
  });

  afterAll(async () => {
    await wipe();
    await app.close();
  });


  it("401 when no token is provided", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/audit/risks",
      payload: { riskCode: "RC-1", title: "Test risk", likelihood: "possible", impact: "moderate" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without write access (employee)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/audit/risks",
      headers: { authorization: `Bearer ${token(["employee"], TENANT, ACTOR)}`, "content-type": "application/json" },
      payload: { riskCode: "RC-1", title: "Test risk", likelihood: "possible", impact: "moderate" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("202 for audit_officer with a valid body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/audit/risks",
      headers: { authorization: `Bearer ${token(["audit_officer"], TENANT, ACTOR)}`, "content-type": "application/json" },
      payload: { riskCode: "RC-VALID-1", title: "Valid test risk", likelihood: "possible", impact: "moderate" },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe("accepted");
    expect(typeof body.id).toBe("string");
  });

  it("400 when likelihood is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/audit/risks",
      headers: { authorization: `Bearer ${token(["audit_officer"], TENANT, ACTOR)}`, "content-type": "application/json" },
      payload: { riskCode: "RC-2", title: "Missing likelihood", impact: "moderate" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("VALIDATION_FAILED");
  });

  it("400 when impact is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/audit/risks",
      headers: { authorization: `Bearer ${token(["audit_officer"], TENANT, ACTOR)}`, "content-type": "application/json" },
      payload: { riskCode: "RC-3", title: "Missing impact", likelihood: "possible" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("VALIDATION_FAILED");
  });
});

describe("risk consumer — riskCreate (integration)", () => {
  beforeAll(async () => { await wipe(); });
  afterAll(async () => { await wipe(); });

  it("recomputes riskScore server-side and lands the row with tenant scoping", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerRiskConsumers(q);
    await q.start();

    // The wire carries a deliberately WRONG riskScore (999) to prove the
    // consumer never trusts it and always recomputes from likelihood/impact.
    await q.publish(COMMANDS.riskCreate, {
      messageId: MSG_CREATE_1, type: COMMANDS.riskCreate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-risk-1", schemaVersion: "1.0",
      payload: {
        id: RISK_1, tenantId: TENANT, riskCode: "RC-CONSUMER-1", title: "Consumer-created risk",
        category: "operational", likelihood: "likely", impact: "major", riskScore: 999,
      },
    });
    await new Promise<void>((r) => setTimeout(r, 300));
    await q.stop();

    const rows = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(auditRisks).where(eq(auditRisks.id, RISK_1))));
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.tenantId).toBe(TENANT);
    expect(row.riskCode).toBe("RC-CONSUMER-1");
    expect(row.likelihood).toBe("likely");
    expect(row.impact).toBe("major");
    // 4 x 4 = 16, NOT the bogus 999 carried on the wire.
    expect(row.riskScore).toBe(computeRiskScore("likely", "major"));
    expect(row.riskScore).toBe(16);
    expect(row.status).toBe("open");
    expect(row.version).toBe(1);
  });
});

describe("risk consumer — riskUpdate (integration)", () => {
  beforeAll(async () => { await wipe(); await seedRiskForUpdate(); });
  afterAll(async () => { await wipe(); });

  async function seedRiskForUpdate(): Promise<void> {
    await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(auditRisks).values({
      id: RISK_2, tenantId: TENANT, riskCode: "RC-UPDATE-1", title: "Risk to be updated",
      category: "financial", likelihood: "possible", impact: "moderate",
      riskScore: computeRiskScore("possible", "moderate"),
      status: "open", createdBy: ACTOR, updatedBy: ACTOR,
    })));
  }

  it("increments version and applies updated likelihood/impact/status", async () => {
    const before = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(auditRisks).where(eq(auditRisks.id, RISK_2))));
    const beforeVersion = before[0]!.version;

    const q = wireTenantAwareQueue(new MemoryQueue());
    registerRiskConsumers(q);
    await q.start();

    await q.publish(COMMANDS.riskUpdate, {
      messageId: MSG_UPDATE_1, type: COMMANDS.riskUpdate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-risk-2", schemaVersion: "1.0",
      payload: {
        // NOTE: status uses "accepted" here (not "escalated") — the DB CHECK
        // constraint added in migrations/0016_check_constraints_status_columns.sql
        // only allows ('open','mitigating','closed','accepted') for
        // risk.audit_risks.status, which is narrower than the "escalated"
        // value validators.ts accepts at the HTTP boundary. That mismatch is
        // a pre-existing schema/validator inconsistency outside this test's
        // scope; using a DB-valid status here keeps this test focused on the
        // consumer's version-increment + recompute behavior.
        riskId: RISK_2, tenantId: TENANT, likelihood: "almost_certain", impact: "catastrophic",
        status: "accepted", mitigationStatus: "in_progress",
      },
    });
    await new Promise<void>((r) => setTimeout(r, 300));
    await q.stop();

    const after = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(auditRisks).where(eq(auditRisks.id, RISK_2))));
    const row = after[0]!;
    expect(row.version).toBe(beforeVersion + 1);
    expect(row.likelihood).toBe("almost_certain");
    expect(row.impact).toBe("catastrophic");
    expect(row.status).toBe("accepted");
    expect(row.mitigationStatus).toBe("in_progress");
    expect(row.riskScore).toBe(computeRiskScore("almost_certain", "catastrophic"));
    expect(row.riskScore).toBe(25);
  });
});

describe("risk consumer — idempotency", () => {
  const RISK_IDEMPOTENT = randomUUID();

  beforeAll(async () => { await wipe(); });
  afterAll(async () => {
    // RISK_IDEMPOTENT is not deleted here: risk.audit_risks is a
    // case-of-record table guarded by migration 0027's BEFORE DELETE OR
    // TRUNCATE trigger. It's randomUUID()-scoped per test run, so the
    // leftover row is harmless and never collides with a later run.
    await wipe();
    await sqlClient.end();
  });

  it("republishing the same riskCreate messageId does not create a duplicate row", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerRiskConsumers(q);
    await q.start();

    const publishMsg = () => q.publish(COMMANDS.riskCreate, {
      messageId: MSG_DUP, type: COMMANDS.riskCreate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-risk-dup", schemaVersion: "1.0",
      payload: {
        id: RISK_IDEMPOTENT, tenantId: TENANT, riskCode: "RC-IDEMPOTENT-1", title: "Idempotency test risk",
        category: "it", likelihood: "unlikely", impact: "minor", riskScore: 4,
      },
    });

    await publishMsg();
    await new Promise<void>((r) => setTimeout(r, 300));
    // Republish the exact same messageId — markProcessed must short-circuit this.
    await publishMsg();
    await new Promise<void>((r) => setTimeout(r, 300));
    await q.stop();

    const rows = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(auditRisks).where(eq(auditRisks.id, RISK_IDEMPOTENT))));
    expect(rows).toHaveLength(1);
  });
});
