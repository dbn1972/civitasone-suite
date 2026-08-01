/**
 * Tour-plan approval workflow — CQRS write-path round-trip integration tests
 * (SVC-109).
 *
 * COMMANDS.tourPlanSubmit / COMMANDS.tourPlanApprove were published by
 * routes.ts -> commands.ts and returned 202, but no consumer ever subscribed
 * to them, so a submit/approve request never actually transitioned the tour
 * plan's status — a live black-hole facade. These tests prove the consumer
 * now wired in modules/assignment/consumer.ts actually persists: they POST
 * through the real HTTP route, drive the in-memory queue to deliver the
 * command to the consumer, then assert the status transition landed in
 * Postgres (not merely that the route returned 202).
 *
 * Covered:
 *   1. submit    -> status draft -> submitted (row persisted, not just 202)
 *   2. approve   -> status submitted -> approved, by a DIFFERENT actor
 *   3. idempotency -> redelivered messageId does not double-apply either transition
 *   4. maker-checker -> approver == submitter is rejected; status stays 'submitted'
 *   5. RLS cross-tenant isolation -> tenant B cannot read/act on tenant A's plan
 *   6. invalid transition -> approving a plan still in 'draft' (never submitted) is rejected
 *
 * Validates: SVC-109 tour-plan approval workflow (COMMANDS.tourPlanSubmit,
 * COMMANDS.tourPlanApprove), Requirements 4.4.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { MemoryQueue } from "@civitasone/queue";
import { eq, inArray } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { tenantScoped } from "../src/shared/tenant-queue.js";
import { registerAssignmentConsumers } from "../src/modules/assignment/consumer.js";
import { COMMANDS } from "../src/topics.js";
import { tourPlans } from "../src/modules/assignment/schema.js";
import { processed } from "../src/shared/outbox.js";
import { runWithTenant } from "@civitasone/db";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT_A = "a1a1a1a1-0000-4000-8000-000000005109";
const TENANT_B = "b2b2b2b2-0000-4000-8000-000000005109";
const INSPECTOR   = "c3c3c3c3-0000-4000-8000-0000000e5901";
const SUPERVISOR  = "d4d4d4d4-0000-4000-8000-0000000005f1";
const ADMIN_BOTH  = "e5e5e5e5-0000-4000-8000-0000000ad001"; // holds both inspector + supervising roles

function tokenFor(tenantId: string, actorId: string, roles: string[]): string {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-svc109" }, SECRET, 3600);
}
function hdr(tenantId: string, actorId: string, roles: string[]) {
  return {
    authorization: `Bearer ${tokenFor(tenantId, actorId, roles)}`,
    "x-tenant-id": tenantId,
    "content-type": "application/json",
  };
}

const drain = () => (queue as unknown as MemoryQueue).drain();

let app: FastifyInstance;

/**
 * Fixed message ids so the idempotency tests are deterministic. They are
 * cleared from `_inbox.processed` between runs — see cleanup() — otherwise
 * markProcessed(tx, messageId) returns false forever after the first run and
 * every "redelivery does not double-apply" assertion would pass vacuously
 * (no write ever ran at all, on any run).
 */
const FIXED_MESSAGE_IDS = [
  "f6f6f6f6-0000-4000-8000-0000000005cd",
  "f6f6f6f6-0000-4000-8000-0000000000ad",
] as const;

async function cleanup(): Promise<void> {
  for (const t of [TENANT_A, TENANT_B]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(tourPlans).where(eq(tourPlans.tenantId, t));
    }));
  }
  await runWithTenant(TENANT_A, () => db.transaction(async (tx) => {
    await tx.delete(processed).where(inArray(processed.messageId, [...FIXED_MESSAGE_IDS]));
  }));
}

beforeAll(async () => {
  tenantScoped(queue);
  registerAssignmentConsumers(tenantScoped(queue));
  app = await buildApp();
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

/** Generate a draft tour plan (legacy empty-slot shape, no geo sites needed) and return its id. */
async function createDraftTourPlan(tenantId: string, inspectorId: string, period: [string, string]): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/inspection/tour-plans/generate",
    headers: hdr(tenantId, SUPERVISOR, ["supervising_officer"]),
    payload: {
      inspectorId,
      periodStart: period[0],
      periodEnd: period[1],
      maxDailyInspections: 2,
    },
  });
  expect(res.statusCode).toBe(202);
  await drain();

  const get = await app.inject({
    method: "GET",
    url: `/v1/inspection/tour-plans/${inspectorId}`,
    headers: hdr(tenantId, SUPERVISOR, ["supervising_officer"]),
  });
  expect(get.statusCode).toBe(200);
  return get.json().data.id as string;
}

async function readTourPlanRow(tenantId: string, id: string) {
  const rows = await runWithTenant(tenantId, () => db.transaction(async (tx) =>
    tx.select().from(tourPlans).where(eq(tourPlans.id, id))));
  return rows[0];
}

describe("tour-plan submit — round-trip (persists, not just 202)", () => {
  it("POST .../submit -> consumer transitions draft -> submitted", async () => {
    const id = await createDraftTourPlan(TENANT_A, INSPECTOR, ["2026-09-01", "2026-09-05"]);

    let row = await readTourPlanRow(TENANT_A, id);
    expect(row!.status).toBe("draft");
    expect(row!.submittedBy).toBeNull();

    const res = await app.inject({
      method: "POST",
      url: `/v1/inspection/tour-plans/${id}/submit`,
      headers: hdr(TENANT_A, INSPECTOR, ["inspector"]),
      payload: {},
    });
    expect(res.statusCode).toBe(202);
    await drain();

    row = await readTourPlanRow(TENANT_A, id);
    expect(row!.status).toBe("submitted");
    expect(row!.submittedBy).toBe(INSPECTOR);
    expect(row!.submittedAt).not.toBeNull();
  });
});

describe("tour-plan approve — round-trip, different actor than submitter", () => {
  it("POST .../approve -> consumer transitions submitted -> approved", async () => {
    const id = await createDraftTourPlan(TENANT_A, INSPECTOR, ["2026-09-08", "2026-09-12"]);

    await app.inject({
      method: "POST", url: `/v1/inspection/tour-plans/${id}/submit`, headers: hdr(TENANT_A, INSPECTOR, ["inspector"]), payload: {},
    });
    await drain();

    const res = await app.inject({
      method: "POST",
      url: `/v1/inspection/tour-plans/${id}/approve`,
      headers: hdr(TENANT_A, SUPERVISOR, ["supervising_officer"]),
      payload: {},
    });
    expect(res.statusCode).toBe(202);
    await drain();

    const row = await readTourPlanRow(TENANT_A, id);
    expect(row!.status).toBe("approved");
    expect(row!.approvedBy).toBe(SUPERVISOR);
    expect(row!.approvedAt).not.toBeNull();
    expect(row!.submittedBy).toBe(INSPECTOR); // maker preserved alongside checker
  });
});

describe("tour-plan approval — idempotency", () => {
  it("redelivering the same submit messageId does not double-apply", async () => {
    const id = await createDraftTourPlan(TENANT_A, INSPECTOR, ["2026-09-15", "2026-09-19"]);
    const [submitMsgId] = FIXED_MESSAGE_IDS;

    await queue.publish(COMMANDS.tourPlanSubmit, {
      messageId: submitMsgId, type: COMMANDS.tourPlanSubmit, tenantId: TENANT_A, actorId: INSPECTOR,
      correlationId: "corr-idem-submit", schemaVersion: "1.0",
      payload: { tourPlanId: id, tenantId: TENANT_A },
    });
    await drain();
    // Redeliver the identical messageId — must be a no-op, not a double transition.
    await queue.publish(COMMANDS.tourPlanSubmit, {
      messageId: submitMsgId, type: COMMANDS.tourPlanSubmit, tenantId: TENANT_A, actorId: INSPECTOR,
      correlationId: "corr-idem-submit-2", schemaVersion: "1.0",
      payload: { tourPlanId: id, tenantId: TENANT_A },
    });
    await drain();

    const row = await readTourPlanRow(TENANT_A, id);
    expect(row!.status).toBe("submitted");
    expect(row!.version).toBe(2); // exactly one transition applied (1 -> 2)
  });

  it("redelivering the same approve messageId does not double-apply", async () => {
    const id = await createDraftTourPlan(TENANT_A, INSPECTOR, ["2026-09-22", "2026-09-26"]);
    await app.inject({
      method: "POST", url: `/v1/inspection/tour-plans/${id}/submit`, headers: hdr(TENANT_A, INSPECTOR, ["inspector"]), payload: {},
    });
    await drain();

    const [, approveMsgId] = FIXED_MESSAGE_IDS;
    const mk = () => ({
      messageId: approveMsgId, type: COMMANDS.tourPlanApprove, tenantId: TENANT_A, actorId: SUPERVISOR,
      correlationId: "corr-idem-approve", schemaVersion: "1.0",
      payload: { tourPlanId: id, tenantId: TENANT_A },
    });
    await queue.publish(COMMANDS.tourPlanApprove, mk());
    await drain();
    await queue.publish(COMMANDS.tourPlanApprove, mk());
    await drain();

    const row = await readTourPlanRow(TENANT_A, id);
    expect(row!.status).toBe("approved");
    expect(row!.version).toBe(3); // draft(1) -> submitted(2) -> approved(3), approved exactly once
  });

  it("a fresh messageId redelivery that finds the plan already approved is a safe no-op", async () => {
    const id = await createDraftTourPlan(TENANT_A, INSPECTOR, ["2026-09-29", "2026-10-03"]);
    await app.inject({ method: "POST", url: `/v1/inspection/tour-plans/${id}/submit`, headers: hdr(TENANT_A, INSPECTOR, ["inspector"]) , payload: {} });
    await drain();
    await app.inject({ method: "POST", url: `/v1/inspection/tour-plans/${id}/approve`, headers: hdr(TENANT_A, SUPERVISOR, ["supervising_officer"]) , payload: {} });
    await drain();

    // A different messageId (simulating a client retry after a slow response)
    // targeting an already-approved plan must not error and must not re-transition.
    const res = await app.inject({
      method: "POST", url: `/v1/inspection/tour-plans/${id}/approve`, headers: hdr(TENANT_A, SUPERVISOR, ["supervising_officer"]), payload: {},
    });
    expect(res.statusCode).toBe(202);
    await drain();

    const row = await readTourPlanRow(TENANT_A, id);
    expect(row!.status).toBe("approved");
    expect(row!.version).toBe(3);
  });
});

describe("tour-plan approval — maker-checker (approver must differ from submitter)", () => {
  it("same actor cannot both submit and approve; status stays 'submitted'", async () => {
    const id = await createDraftTourPlan(TENANT_A, INSPECTOR, ["2026-10-06", "2026-10-10"]);

    // ADMIN_BOTH holds both role groups, so the ROUTE-level RBAC lets them
    // hit both endpoints — the maker-checker rule must be enforced by the
    // CONSUMER, not just by role separation.
    const submitRes = await app.inject({
      method: "POST", url: `/v1/inspection/tour-plans/${id}/submit`,
      headers: hdr(TENANT_A, ADMIN_BOTH, ["inspector", "supervising_officer"]),
      payload: {},
    });
    expect(submitRes.statusCode).toBe(202);
    await drain();

    let row = await readTourPlanRow(TENANT_A, id);
    expect(row!.status).toBe("submitted");
    expect(row!.submittedBy).toBe(ADMIN_BOTH);

    const mq = queue as unknown as MemoryQueue;
    const before = mq.dlq.length;

    const approveRes = await app.inject({
      method: "POST", url: `/v1/inspection/tour-plans/${id}/approve`,
      headers: hdr(TENANT_A, ADMIN_BOTH, ["inspector", "supervising_officer"]),
      payload: {},
    });
    expect(approveRes.statusCode).toBe(202); // route accepts; consumer rejects
    await drain();

    row = await readTourPlanRow(TENANT_A, id);
    expect(row!.status).toBe("submitted"); // NOT approved
    expect(row!.approvedBy).toBeNull();

    const newDlq = mq.dlq.slice(before);
    // domain.ts DomainError does not prefix its `code` into `.message`, so the
    // DLQ's error string (== err.message) is matched on the human-readable text.
    expect(newDlq.some((d) => d.error.includes("cannot be approved by the same person"))).toBe(true);
  });
});

describe("tour-plan approval — invalid transition", () => {
  it("approving a plan that was never submitted (still 'draft') is rejected", async () => {
    const id = await createDraftTourPlan(TENANT_A, INSPECTOR, ["2026-10-13", "2026-10-17"]);

    const mq = queue as unknown as MemoryQueue;
    const before = mq.dlq.length;

    const res = await app.inject({
      method: "POST", url: `/v1/inspection/tour-plans/${id}/approve`,
      headers: hdr(TENANT_A, SUPERVISOR, ["supervising_officer"]),
      payload: {},
    });
    expect(res.statusCode).toBe(202); // route accepts; consumer rejects
    await drain();

    const row = await readTourPlanRow(TENANT_A, id);
    expect(row!.status).toBe("draft"); // unchanged

    const newDlq = mq.dlq.slice(before);
    expect(newDlq.some((d) => d.error.includes("Cannot transition tour plan from 'draft' to 'approved'"))).toBe(true);
  });
});

describe("tour-plan approval — RLS cross-tenant isolation", () => {
  it("tenant B's approve command cannot transition tenant A's tour plan", async () => {
    const id = await createDraftTourPlan(TENANT_A, INSPECTOR, ["2026-10-20", "2026-10-24"]);
    await app.inject({ method: "POST", url: `/v1/inspection/tour-plans/${id}/submit`, headers: hdr(TENANT_A, INSPECTOR, ["inspector"]) , payload: {} });
    await drain();

    const mq = queue as unknown as MemoryQueue;
    const before = mq.dlq.length;

    // Publish directly on the queue with tenantId = TENANT_B but targeting
    // tenant A's plan id — RLS (scoped by the tenantScoped queue wrapper,
    // which sets app.tenant_id = TENANT_B for this handler invocation) must
    // make the row invisible, so the guarded UPDATE matches zero rows.
    await queue.publish(COMMANDS.tourPlanApprove, {
      messageId: "aaaaaaaa-0000-4000-8000-000000005ea1",
      type: COMMANDS.tourPlanApprove, tenantId: TENANT_B, actorId: SUPERVISOR,
      correlationId: "corr-xtenant", schemaVersion: "1.0",
      payload: { tourPlanId: id, tenantId: TENANT_B },
    });
    await drain();

    const row = await readTourPlanRow(TENANT_A, id);
    expect(row!.status).toBe("submitted"); // untouched by tenant B's command

    const newDlq = mq.dlq.slice(before);
    expect(newDlq.length).toBeGreaterThan(0); // dead-lettered as "not found for tenant"

    // And the GET route confirms tenant B cannot even read it.
    const asB = await app.inject({
      method: "GET", url: `/v1/inspection/tour-plans/${INSPECTOR}`, headers: hdr(TENANT_B, SUPERVISOR, ["supervising_officer"]),
    });
    expect(asB.statusCode).toBe(404);
  });
});
