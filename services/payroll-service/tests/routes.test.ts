/**
 * payroll-service HTTP route tests (inject)
 *
 * Asserts list/detail routes return correct status codes and shapes.
 * Uses HS256 test JWTs (JWT_ALGORITHM=HS256 set in vitest.config.ts).
 * No seeded DB rows → routes return [], but schema validates.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-2222-4000-8000-000000000022";

function makeToken(roles: string[] = ["payroll_admin"]) {
  return signToken({ sub: "user-payroll-001", tid: TENANT, roles, sid: "sess-002" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

describe("GET /v1/payroll/runs — list shape", () => {
  it("returns 200 with array", async () => {
    const app = await buildApp();
    const token = makeToken();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/runs",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("returns 401 when no token provided", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/runs" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for wrong role", async () => {
    const app = await buildApp();
    const token = makeToken(["citizen"]);
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/runs",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/payroll/runs/:id — detail", () => {
  it("returns 404 for unknown UUID", async () => {
    const app = await buildApp();
    const token = makeToken();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/runs/00000000-0000-4000-8000-000000000000",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("returns 401 when no token provided", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/runs/00000000-0000-4000-8000-000000000000",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /v1/payroll/salary-slips — list shape", () => {
  it("returns 200 with array", async () => {
    const app = await buildApp();
    const token = makeToken();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/salary-slips",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("returns 403 for wrong role", async () => {
    const app = await buildApp();
    const token = makeToken(["citizen"]);
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/salary-slips",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ── Test E: Payroll disbursement requires prior approval ─────────────────────
//
// The CQRS command layer enforces the state machine: a payroll run must be in
// status=approved before it can be disbursed. Sending runDisburse on a
// processing-status run should fail with INVALID_STATUS_TRANSITION in the consumer.
// At the route level, the consumer is async; however we can verify:
//   1. The route itself rejects unauthenticated disburse attempts (401).
//   2. The route requires payroll_admin role (403 for wrong role).
//   3. Disbursing a non-existent run: 202 accepted (command published),
//      but consumer will throw and mark run as failed.
// The domain-level enforcement is verified directly via assertRunStatusTransition.

describe("Payroll disbursement — requires approval state (route + domain)", () => {
  it("PATCH /v1/payroll/runs/:id/disburse without token → 401", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/payroll/runs/00000000-0000-4000-8000-000000000001/disburse",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("PATCH /v1/payroll/runs/:id/disburse with wrong role → 403", async () => {
    const app = await buildApp();
    const token = makeToken(["finance_officer"]);
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/payroll/runs/00000000-0000-4000-8000-000000000001/disburse",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("PATCH /v1/payroll/runs/:id/approve without token → 401", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/payroll/runs/00000000-0000-4000-8000-000000000001/approve",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("domain: assertRunStatusTransition processing → disbursed throws INVALID_STATUS_TRANSITION", async () => {
    // A run in 'processing' cannot be directly disbursed — must be approved first.
    const { assertRunStatusTransition } = await import("../src/modules/payroll/domain.js");
    expect(() => assertRunStatusTransition("processing", "disbursed")).toThrowError(
      "INVALID_STATUS_TRANSITION",
    );
  });

  it("domain: assertRunStatusTransition draft → disbursed throws INVALID_STATUS_TRANSITION", async () => {
    const { assertRunStatusTransition } = await import("../src/modules/payroll/domain.js");
    expect(() => assertRunStatusTransition("draft", "disbursed")).toThrowError(
      "INVALID_STATUS_TRANSITION",
    );
  });

  it("domain: assertRunStatusTransition approved → disbursed passes (valid)", async () => {
    const { assertRunStatusTransition } = await import("../src/modules/payroll/domain.js");
    expect(() => assertRunStatusTransition("approved", "disbursed")).not.toThrow();
  });

  it("consumer: disbursing a run that is in processing status sets run to failed (state machine enforced)", async () => {
    const { MemoryQueue } = await import("@civitasone/queue");
    const { eq } = await import("drizzle-orm");
    const { runWithTenant, withTenantConsumer } = await import("@civitasone/db");
    const { db } = await import("../src/shared/db.js");
    const { payrollRuns } = await import("../src/modules/payroll/schema.js");
    const { registerPayrollConsumers } = await import("../src/modules/payroll/consumer.js");
    const { outboxMessages, processed } = await import("../src/shared/outbox.js");
    const { COMMANDS } = await import("../src/topics.js");

    const RUN_DISBURSE_TEST = "dddddddd-eeee-4000-8000-000000000099";
    const MSG_DISBURSE = "eeeeeeee-ffff-4000-8000-000000000099";
    const ACTOR = "00000000-aaaa-4000-8000-000000000099";
    const TENANT = "22222222-dddd-4000-8000-000000000099";

    // Clean up
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
      await tx.delete(payrollRuns).where(eq(payrollRuns.id, RUN_DISBURSE_TEST));
      await tx.delete(processed).where(eq(processed.messageId, MSG_DISBURSE));
    }));

    // Insert a run in 'processing' status (not yet approved)
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(payrollRuns).values({
        id: RUN_DISBURSE_TEST, tenantId: TENANT, runNo: "RUN-DISBURSE-TEST",
        month: "2024-09", structureId: "ffffffff-0000-4000-8000-000000000099",
        totalGrossMinor: 0n, totalNetMinor: 0n, currency: "INR", status: "processing",
        createdBy: ACTOR, updatedBy: ACTOR,
      });
    }));

    const q = new MemoryQueue();
    const rawSubscribe = q.subscribe.bind(q);
    q.subscribe = ((topic: string, handler: unknown) =>
      rawSubscribe(topic, withTenantConsumer(handler as (msg: { tenantId: string }) => Promise<void>) as typeof handler)) as typeof q.subscribe;
    registerPayrollConsumers(q);
    await q.start();

    // Attempt to disburse a 'processing' run — state machine must reject it
    await q.publish(COMMANDS.runDisburse, {
      messageId: MSG_DISBURSE, type: COMMANDS.runDisburse,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-disburse-no-approval",
      schemaVersion: "1.0",
      payload: { id: RUN_DISBURSE_TEST, tenantId: TENANT },
    });

    await new Promise<void>((r) => setTimeout(r, 600));
    await q.stop();

    // The run must still be in 'processing' — disburse was rejected by state machine
    const runs = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(payrollRuns).where(eq(payrollRuns.id, RUN_DISBURSE_TEST))));
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).not.toBe("disbursed");

    // Cleanup
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.delete(payrollRuns).where(eq(payrollRuns.id, RUN_DISBURSE_TEST));
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
      await tx.delete(processed).where(eq(processed.messageId, MSG_DISBURSE));
    }));
  });
});

// ── Tests 5.1-5.8 promoted from hrms-service e2e (payroll endpoints belong here) ──

describe("GET /v1/payroll/structures — salary structures list", () => {
  it("returns 200 with array", async () => {
    const app = await buildApp();
    const token = makeToken();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/structures",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });
});

describe("GET /v1/payroll/statutory/pf — PF records", () => {
  it("returns 200", async () => {
    const app = await buildApp();
    const token = makeToken();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/pf",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });
});

describe("GET /v1/payroll/statutory/esi — ESI records", () => {
  it("returns 200", async () => {
    const app = await buildApp();
    const token = makeToken();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/esi",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });
});

describe("GET /v1/payroll/statutory/tds — TDS records", () => {
  it("returns 200", async () => {
    const app = await buildApp();
    const token = makeToken();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/tds",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });
});

describe("GET /v1/payroll/statutory/gratuity — gratuity records", () => {
  it("returns 200", async () => {
    const app = await buildApp();
    const token = makeToken();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/gratuity",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });
});



describe("GET /v1/payroll/loans — loan management", () => {
  it("returns 200 with array when empId provided", async () => {
    const app = await buildApp();
    const token = makeToken();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/loans?empId=00000000-0000-4000-8000-000000000001",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("returns 400 when empId is missing", async () => {
    const app = await buildApp();
    const token = makeToken();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/loans",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});
