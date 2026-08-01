/**
 * contract-service obligations, renewals, and approvals test suite
 *
 * Test coverage:
 * - Approval matrix: resolveApprovalLevel domain logic
 * - Obligation: reminder scheduling at 30d/14d/7d
 * - Renewal: advance notice window computation
 * - Route-level tests: CRUD, auth, validation
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withTenantScope } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { contractObligations, obligationReminders } from "../src/modules/obligations/schema.js";
import { contractRenewals } from "../src/modules/renewals/schema.js";
import { approvalLevels } from "../src/modules/approvals/schema.js";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

// Domain imports for unit tests
import { computeReminderSchedule, validateStatusTransition } from "../src/modules/obligations/domain.js";
import { computeRenewalNotices, isWithinNoticeWindow } from "../src/modules/renewals/domain.js";
import { resolveApprovalLevel } from "../src/modules/approvals/domain.js";

// Repo imports — the obligations/renewals/approvals routes are queue-first CQRS
// (POST/PATCH/DELETE publish to the queue and return 202; a worker-side consumer
// performs the actual write). These route tests use `buildApp()` without a
// running consumer, so route tests seed fixtures directly via the repo instead
// of relying on a prior POST having landed in the database.
import * as obligationRepo from "../src/modules/obligations/repo.js";
import * as renewalRepo from "../src/modules/renewals/repo.js";
import * as approvalRepo from "../src/modules/approvals/repo.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "cccccccc-1111-4000-8000-000000000020";
const ACTOR  = "aaaaaaaa-2222-4000-8000-000000000020";
const CONTRACT_ID = "bbbbbbbb-3333-4000-8000-000000000020";

function makeToken(roles: string[] = ["super_admin"], tenantId = TENANT) {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-oblig-001" }, SECRET);
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

async function cleanup() {
  try {
    await withTenantScope(db, TENANT, async (tx) => {
      await tx.delete(obligationReminders).where(eq(obligationReminders.tenantId, TENANT));
      await tx.delete(contractObligations).where(eq(contractObligations.tenantId, TENANT));
      await tx.delete(contractRenewals).where(eq(contractRenewals.tenantId, TENANT));
      await tx.delete(approvalLevels).where(eq(approvalLevels.tenantId, TENANT));
    });
  } catch {
    // Tables may not exist yet in test environment
  }
}

beforeEach(async () => {
  await cleanup();
});

// ════════════════════════════════════════════════════════════════════════════
// DOMAIN LOGIC — Approval Matrix Resolution
// ════════════════════════════════════════════════════════════════════════════

describe("resolveApprovalLevel — domain logic", () => {
  it("returns null for empty levels array", () => {
    const result = resolveApprovalLevel(100000n, []);
    expect(result).toBeNull();
  });

  it("returns null when contractValue is below all thresholds", () => {
    const levels = [
      { minValuePaise: 100000n, requiredRole: "manager" },
      { minValuePaise: 500000n, requiredRole: "director" },
    ];
    const result = resolveApprovalLevel(50000n, levels);
    expect(result).toBeNull();
  });

  it("returns the highest matching level", () => {
    const levels = [
      { minValuePaise: 100000n, requiredRole: "manager" },
      { minValuePaise: 500000n, requiredRole: "director" },
      { minValuePaise: 1000000n, requiredRole: "cfo" },
    ];
    const result = resolveApprovalLevel(750000n, levels);
    expect(result).toEqual({ minValuePaise: 500000n, requiredRole: "director" });
  });

  it("returns the exact match when contractValue equals minValuePaise", () => {
    const levels = [
      { minValuePaise: 100000n, requiredRole: "manager" },
      { minValuePaise: 500000n, requiredRole: "director" },
    ];
    const result = resolveApprovalLevel(500000n, levels);
    expect(result).toEqual({ minValuePaise: 500000n, requiredRole: "director" });
  });

  it("works with unsorted input levels", () => {
    const levels = [
      { minValuePaise: 1000000n, requiredRole: "cfo" },
      { minValuePaise: 100000n, requiredRole: "manager" },
      { minValuePaise: 500000n, requiredRole: "director" },
    ];
    const result = resolveApprovalLevel(1500000n, levels);
    expect(result).toEqual({ minValuePaise: 1000000n, requiredRole: "cfo" });
  });

  it("returns lowest level for value at lowest threshold", () => {
    const levels = [
      { minValuePaise: 100000n, requiredRole: "manager" },
      { minValuePaise: 500000n, requiredRole: "director" },
    ];
    const result = resolveApprovalLevel(100000n, levels);
    expect(result).toEqual({ minValuePaise: 100000n, requiredRole: "manager" });
  });

  it("handles single level correctly", () => {
    const levels = [{ minValuePaise: 0n, requiredRole: "any_officer" }];
    const result = resolveApprovalLevel(1n, levels);
    expect(result).toEqual({ minValuePaise: 0n, requiredRole: "any_officer" });
  });

  it("handles 5 levels (max allowed)", () => {
    const levels = [
      { minValuePaise: 0n, requiredRole: "clerk" },
      { minValuePaise: 100000n, requiredRole: "officer" },
      { minValuePaise: 500000n, requiredRole: "manager" },
      { minValuePaise: 1000000n, requiredRole: "director" },
      { minValuePaise: 5000000n, requiredRole: "cfo" },
    ];
    const result = resolveApprovalLevel(3000000n, levels);
    expect(result).toEqual({ minValuePaise: 1000000n, requiredRole: "director" });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DOMAIN LOGIC — Obligation Reminder Scheduling
// ════════════════════════════════════════════════════════════════════════════

describe("computeReminderSchedule — domain logic", () => {
  it("generates 3 reminders when due date is far in the future", () => {
    const schedule = computeReminderSchedule("2025-06-01", "2025-04-01");
    expect(schedule).toHaveLength(3);
    expect(schedule[0]!.daysBefore).toBe(30);
    expect(schedule[0]!.reminderDate).toBe("2025-05-02");
    expect(schedule[1]!.daysBefore).toBe(14);
    expect(schedule[1]!.reminderDate).toBe("2025-05-18");
    expect(schedule[2]!.daysBefore).toBe(7);
    expect(schedule[2]!.reminderDate).toBe("2025-05-25");
  });

  it("filters out past reminders", () => {
    // Today is May 20, due June 1 — only 7d reminder (May 25) is in the future
    const schedule = computeReminderSchedule("2025-06-01", "2025-05-20");
    expect(schedule).toHaveLength(1);
    expect(schedule[0]!.daysBefore).toBe(7);
    expect(schedule[0]!.reminderDate).toBe("2025-05-25");
  });

  it("returns empty array when all reminders are in the past", () => {
    // Today is May 30, due June 1 — all reminders are in the past
    const schedule = computeReminderSchedule("2025-06-01", "2025-05-30");
    expect(schedule).toHaveLength(0);
  });

  it("includes today as a valid reminder date", () => {
    // Today is exactly 14 days before due — 14d and 7d should be included
    const schedule = computeReminderSchedule("2025-06-15", "2025-06-01");
    expect(schedule).toHaveLength(2);
    expect(schedule[0]!.daysBefore).toBe(14);
    expect(schedule[1]!.daysBefore).toBe(7);
  });

  it("returns empty for past due dates", () => {
    const schedule = computeReminderSchedule("2025-01-01", "2025-03-01");
    expect(schedule).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DOMAIN LOGIC — Renewal Notice Window
// ════════════════════════════════════════════════════════════════════════════

describe("computeRenewalNotices — domain logic", () => {
  it("computes advance notice and final reminder dates", () => {
    const notices = computeRenewalNotices("2025-12-31", 30);
    expect(notices.advanceNoticeDate).toBe("2025-12-01");
    expect(notices.finalReminderDate).toBe("2025-12-24");
  });

  it("clamps below-minimum notice days to 7", () => {
    const notices = computeRenewalNotices("2025-12-31", 3);
    expect(notices.advanceNoticeDate).toBe("2025-12-24");
    expect(notices.finalReminderDate).toBe("2025-12-24");
  });

  it("clamps above-maximum notice days to 180", () => {
    const notices = computeRenewalNotices("2025-12-31", 200);
    // 180 days before Dec 31 = Jul 4 (181 days is Jul 3, so 180 days = Jul 4)
    expect(notices.advanceNoticeDate).toBe("2025-07-04");
    expect(notices.finalReminderDate).toBe("2025-12-24");
  });

  it("handles advance notice of exactly 7 (min) — both dates coincide", () => {
    const notices = computeRenewalNotices("2025-06-15", 7);
    expect(notices.advanceNoticeDate).toBe("2025-06-08");
    expect(notices.finalReminderDate).toBe("2025-06-08");
  });
});

describe("isWithinNoticeWindow — domain logic", () => {
  it("returns true when today is within the notice window", () => {
    expect(isWithinNoticeWindow("2025-12-31", 30, "2025-12-15")).toBe(true);
  });

  it("returns true on the first day of the window", () => {
    expect(isWithinNoticeWindow("2025-12-31", 30, "2025-12-01")).toBe(true);
  });

  it("returns true on the expiry date itself", () => {
    expect(isWithinNoticeWindow("2025-12-31", 30, "2025-12-31")).toBe(true);
  });

  it("returns false before the notice window starts", () => {
    expect(isWithinNoticeWindow("2025-12-31", 30, "2025-11-15")).toBe(false);
  });

  it("returns false after the expiry date", () => {
    expect(isWithinNoticeWindow("2025-12-31", 30, "2026-01-01")).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DOMAIN LOGIC — Obligation Status Transitions
// ════════════════════════════════════════════════════════════════════════════

describe("validateStatusTransition — domain logic", () => {
  it("allows pending → in_progress", () => {
    expect(validateStatusTransition("pending", "in_progress")).toBe(true);
  });

  it("allows pending → completed", () => {
    expect(validateStatusTransition("pending", "completed")).toBe(true);
  });

  it("allows in_progress → completed", () => {
    expect(validateStatusTransition("in_progress", "completed")).toBe(true);
  });

  it("allows overdue → completed", () => {
    expect(validateStatusTransition("overdue", "completed")).toBe(true);
  });

  it("rejects completed → pending", () => {
    expect(validateStatusTransition("completed", "pending")).toBe(false);
  });

  it("rejects completed → in_progress", () => {
    expect(validateStatusTransition("completed", "in_progress")).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ROUTE TESTS — Obligations
// ════════════════════════════════════════════════════════════════════════════

describe("POST /v1/contract/obligations — create obligation", () => {
  it("returns 202 accepted (queue-first CQRS)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/contract/obligations",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: {
        contractId: CONTRACT_ID,
        title: "Deliver Phase 1 Report",
        description: "Monthly progress report delivery",
        dueDate: "2026-06-01",
        ownerId: ACTOR,
      },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("accepted");
    expect(body.correlationId).toBeDefined();
  });

  it("returns 400 for missing required fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/contract/obligations",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { title: "Incomplete" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/contract/obligations",
      payload: { contractId: CONTRACT_ID, title: "Test", dueDate: "2026-01-01", ownerId: ACTOR },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/contract/obligations",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
      payload: { contractId: CONTRACT_ID, title: "Test", dueDate: "2026-01-01", ownerId: ACTOR },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/contract/obligations — list obligations", () => {
  it("returns 200 with data and meta", async () => {
    // Writes are queue-first (see POST test above); seed directly via repo
    // for this read-path test, matching what the obligationCreate consumer does.
    await obligationRepo.insertObligation({
      id: randomUUID(), tenantId: TENANT, contractId: CONTRACT_ID, title: "Test Oblig",
      description: "", dueDate: "2026-06-01", ownerId: ACTOR, status: "pending",
      createdBy: ACTOR, updatedBy: ACTOR,
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/contract/obligations",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toBeDefined();
    expect(body.meta.total).toBeGreaterThanOrEqual(1);
  });

  it("filters by contractId", async () => {
    const otherContract = "bbbbbbbb-4444-4000-8000-000000000020";
    await obligationRepo.insertObligation({
      id: randomUUID(), tenantId: TENANT, contractId: otherContract, title: "Other",
      description: "", dueDate: "2026-06-01", ownerId: ACTOR, status: "pending",
      createdBy: ACTOR, updatedBy: ACTOR,
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/contract/obligations?contractId=${otherContract}`,
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.every((o: any) => o.contractId === otherContract)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ROUTE TESTS — Renewals
// ════════════════════════════════════════════════════════════════════════════

describe("POST /v1/contract/renewals — create renewal", () => {
  it("returns 202 accepted (queue-first CQRS)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/contract/renewals",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: {
        contractId: CONTRACT_ID,
        expiryDate: "2026-12-31",
        advanceNoticeDays: 60,
      },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("accepted");
    expect(body.correlationId).toBeDefined();
  });

  it("returns 400 for invalid advance notice days", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/contract/renewals",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { contractId: CONTRACT_ID, expiryDate: "2026-12-31", advanceNoticeDays: 3 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/contract/renewals",
      payload: { contractId: CONTRACT_ID, expiryDate: "2026-12-31" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/contract/renewals",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
      payload: { contractId: CONTRACT_ID, expiryDate: "2026-12-31" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/contract/renewals — list renewals", () => {
  it("returns 200 with data and meta", async () => {
    // Writes are queue-first (see POST test above); seed directly via repo
    // for this read-path test, matching what the renewalCreate consumer does.
    await renewalRepo.insertRenewal({
      id: randomUUID(), tenantId: TENANT, contractId: CONTRACT_ID,
      expiryDate: "2026-12-31", advanceNoticeDays: 30, status: "active",
      createdBy: ACTOR, updatedBy: ACTOR,
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/contract/renewals",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta.total).toBeGreaterThanOrEqual(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ROUTE TESTS — Approval Levels
// ════════════════════════════════════════════════════════════════════════════

describe("POST /v1/contract/approval-levels — create approval level", () => {
  it("returns 202 accepted (queue-first CQRS)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/contract/approval-levels",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: {
        minValuePaise: "100000",
        requiredRole: "manager",
        label: "Low-value contracts",
      },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("accepted");
  });

  it("returns 422 when exceeding 5 levels", async () => {
    // The count check (MAX_APPROVAL_LEVELS) is a pre-publish read, so seed the
    // 5 existing levels directly via repo (writes are queue-first CQRS).
    for (let i = 0; i < 5; i++) {
      await approvalRepo.insertApprovalLevel({
        id: randomUUID(), tenantId: TENANT, minValuePaise: BigInt((i + 1) * 100000),
        requiredRole: `role_${i}`, label: "", ordinal: i + 1, createdBy: ACTOR, updatedBy: ACTOR,
      });
    }
    // 6th should fail
    const res = await app.inject({
      method: "POST",
      url: "/v1/contract/approval-levels",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { minValuePaise: "600000", requiredRole: "overflow" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("LEVEL_LIMIT_REACHED");
  });

  it("returns 400 for invalid minValuePaise", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/contract/approval-levels",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { minValuePaise: "not-a-number", requiredRole: "manager" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/contract/approval-levels",
      payload: { minValuePaise: "100000", requiredRole: "manager" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/contract/approval-levels",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
      payload: { minValuePaise: "100000", requiredRole: "manager" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/contract/approval-levels — list levels", () => {
  it("returns 200 with serialized bigint values", async () => {
    // Writes are queue-first (see POST test above); seed directly via repo
    // for this read-path test, matching what the approvalLevelCreate consumer does.
    await approvalRepo.insertApprovalLevel({
      id: randomUUID(), tenantId: TENANT, minValuePaise: 500000n, requiredRole: "director",
      label: "", ordinal: 1, createdBy: ACTOR, updatedBy: ACTOR,
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/contract/approval-levels",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data[0].minValuePaise).toBe("500000");
    expect(body.meta.total).toBeGreaterThanOrEqual(1);
  });
});

describe("GET /v1/contract/approval-levels/resolve — resolve level", () => {
  it("returns the matching level for a contract value", async () => {
    // Writes are queue-first (see POST test above); seed directly via repo
    // for this read-path test, matching what the approvalLevelCreate consumer does.
    await approvalRepo.insertApprovalLevel({
      id: randomUUID(), tenantId: TENANT, minValuePaise: 100000n, requiredRole: "officer",
      label: "", ordinal: 1, createdBy: ACTOR, updatedBy: ACTOR,
    });
    await approvalRepo.insertApprovalLevel({
      id: randomUUID(), tenantId: TENANT, minValuePaise: 500000n, requiredRole: "director",
      label: "", ordinal: 2, createdBy: ACTOR, updatedBy: ACTOR,
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/contract/approval-levels/resolve?contractValue=300000",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).not.toBeNull();
    expect(body.data.requiredRole).toBe("officer");
    expect(body.data.minValuePaise).toBe("100000");
  });

  it("returns null when no level matches", async () => {
    await approvalRepo.insertApprovalLevel({
      id: randomUUID(), tenantId: TENANT, minValuePaise: 1000000n, requiredRole: "cfo",
      label: "", ordinal: 1, createdBy: ACTOR, updatedBy: ACTOR,
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/contract/approval-levels/resolve?contractValue=50000",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeNull();
  });
});

describe("DELETE /v1/contract/approval-levels/:id — delete level", () => {
  it("returns 202 on successful deletion", async () => {
    // Writes are queue-first (see POST test above); seed directly via repo
    // so the existence check (pre-publish read) finds a row to delete.
    const seeded = await approvalRepo.insertApprovalLevel({
      id: randomUUID(), tenantId: TENANT, minValuePaise: 200000n, requiredRole: "to_delete",
      label: "", ordinal: 1, createdBy: ACTOR, updatedBy: ACTOR,
    });
    const { id } = seeded;

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/contract/approval-levels/${id}`,
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(202);
  });

  it("returns 404 for non-existent level", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/contract/approval-levels/00000000-0000-4000-8000-000000000000",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
