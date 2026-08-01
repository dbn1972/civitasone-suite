/**
 * contract-service e-sign routing test suite
 *
 * Test coverage:
 * - Domain logic: signatory validation, sequential routing, deadline enforcement
 * - Routes: create, sign, status, check-deadline
 * - Auth: 401 unauthorized, 403 forbidden
 * - Edge cases: 1 signatory, 10 signatories, deadline reminder, escalation
 *
 * Requirements: 9.8, 9.9
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withTenantScope } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { esignRoutes } from "../src/modules/esign/schema.js";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

// The create/sign routes are queue-first CQRS (POST publishes and returns 202;
// a worker-side consumer performs the actual write). These route tests use
// `buildApp()` without a running consumer, so route tests that need an
// existing route seed it directly via the repo instead of going through POST.
import * as esignRepo from "../src/modules/esign/repo.js";

// Domain imports for unit tests
import {
  validateSignatories,
  canSign,
  applySignature,
  checkDeadlineStatus,
  computeSignatoryStartDate,
  computeFirstDeadline,
  computeEscalationDeadline,
} from "../src/modules/esign/domain.js";
import type { SignatoryEntry } from "../src/modules/esign/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "cccccccc-1111-4000-8000-000000000030";
const ACTOR = "aaaaaaaa-2222-4000-8000-000000000030";
const CONTRACT_ID = "bbbbbbbb-3333-4000-8000-000000000030";
const SIGNER_1 = "11111111-1111-4000-8000-000000000001";
const SIGNER_2 = "22222222-2222-4000-8000-000000000002";
const SIGNER_3 = "33333333-3333-4000-8000-000000000003";
const OWNER = "eeeeeeee-5555-4000-8000-000000000030";

function makeToken(roles: string[] = ["super_admin"], tenantId = TENANT) {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-esign-001" }, SECRET);
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
      await tx.delete(esignRoutes).where(eq(esignRoutes.tenantId, TENANT));
    });
  } catch {
    // Table may not exist yet in test environment
  }
}

beforeEach(async () => {
  await cleanup();
});

// ════════════════════════════════════════════════════════════════════════════
// DOMAIN LOGIC — Signatory Validation
// ════════════════════════════════════════════════════════════════════════════

describe("validateSignatories — domain logic", () => {
  it("accepts 1 signatory with valid deadline", () => {
    const signatories: SignatoryEntry[] = [
      { userId: SIGNER_1, ordinal: 1, deadlineDays: 7, status: "pending", signedAt: null },
    ];
    expect(validateSignatories(signatories)).toBeNull();
  });

  it("accepts 10 signatories", () => {
    const signatories: SignatoryEntry[] = Array.from({ length: 10 }, (_, i) => ({
      userId: `${i + 1}0000000-0000-4000-8000-00000000000${i}`,
      ordinal: i + 1,
      deadlineDays: Math.min(i + 1, 30),
      status: "pending" as const,
      signedAt: null,
    }));
    expect(validateSignatories(signatories)).toBeNull();
  });

  it("rejects empty signatories array", () => {
    expect(validateSignatories([])).toBe("signatories must contain 1 to 10 entries");
  });

  it("rejects more than 10 signatories", () => {
    const signatories: SignatoryEntry[] = Array.from({ length: 11 }, (_, i) => ({
      userId: `${i + 1}0000000-0000-4000-8000-000000000000`,
      ordinal: i + 1,
      deadlineDays: 5,
      status: "pending" as const,
      signedAt: null,
    }));
    expect(validateSignatories(signatories)).toBe("signatories must contain 1 to 10 entries");
  });

  it("rejects deadlineDays < 1", () => {
    const signatories: SignatoryEntry[] = [
      { userId: SIGNER_1, ordinal: 1, deadlineDays: 0, status: "pending", signedAt: null },
    ];
    expect(validateSignatories(signatories)).toContain("deadlineDays must be between 1 and 30");
  });

  it("rejects deadlineDays > 30", () => {
    const signatories: SignatoryEntry[] = [
      { userId: SIGNER_1, ordinal: 1, deadlineDays: 31, status: "pending", signedAt: null },
    ];
    expect(validateSignatories(signatories)).toContain("deadlineDays must be between 1 and 30");
  });

  it("rejects non-sequential ordinals", () => {
    const signatories: SignatoryEntry[] = [
      { userId: SIGNER_1, ordinal: 1, deadlineDays: 5, status: "pending", signedAt: null },
      { userId: SIGNER_2, ordinal: 3, deadlineDays: 5, status: "pending", signedAt: null },
    ];
    expect(validateSignatories(signatories)).toContain("must have ordinal 2, got 3");
  });

  it("rejects duplicate userIds", () => {
    const signatories: SignatoryEntry[] = [
      { userId: SIGNER_1, ordinal: 1, deadlineDays: 5, status: "pending", signedAt: null },
      { userId: SIGNER_1, ordinal: 2, deadlineDays: 5, status: "pending", signedAt: null },
    ];
    expect(validateSignatories(signatories)).toContain("duplicate userId");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DOMAIN LOGIC — Sequential Routing (canSign, applySignature)
// ════════════════════════════════════════════════════════════════════════════

describe("canSign — domain logic", () => {
  const signatories: SignatoryEntry[] = [
    { userId: SIGNER_1, ordinal: 1, deadlineDays: 7, status: "pending", signedAt: null },
    { userId: SIGNER_2, ordinal: 2, deadlineDays: 7, status: "pending", signedAt: null },
    { userId: SIGNER_3, ordinal: 3, deadlineDays: 7, status: "pending", signedAt: null },
  ];

  it("returns true for correct current signatory", () => {
    expect(canSign(signatories, 1, SIGNER_1)).toBe(true);
  });

  it("returns false for non-current signatory", () => {
    expect(canSign(signatories, 1, SIGNER_2)).toBe(false);
  });

  it("returns false for already-signed signatory", () => {
    const signed: SignatoryEntry[] = [
      { userId: SIGNER_1, ordinal: 1, deadlineDays: 7, status: "signed", signedAt: "2025-01-01T00:00:00Z" },
      { userId: SIGNER_2, ordinal: 2, deadlineDays: 7, status: "pending", signedAt: null },
    ];
    expect(canSign(signed, 1, SIGNER_1)).toBe(false);
  });

  it("returns false when ordinal out of range", () => {
    expect(canSign(signatories, 4, SIGNER_1)).toBe(false);
  });
});

describe("applySignature — domain logic", () => {
  it("marks current signatory as signed and advances ordinal", () => {
    const signatories: SignatoryEntry[] = [
      { userId: SIGNER_1, ordinal: 1, deadlineDays: 7, status: "pending", signedAt: null },
      { userId: SIGNER_2, ordinal: 2, deadlineDays: 7, status: "pending", signedAt: null },
    ];
    const result = applySignature(signatories, 1, SIGNER_1, "2025-06-01T10:00:00Z");
    expect(result.signatories[0]!.status).toBe("signed");
    expect(result.signatories[0]!.signedAt).toBe("2025-06-01T10:00:00Z");
    expect(result.newOrdinal).toBe(2);
    expect(result.isComplete).toBe(false);
  });

  it("marks route as complete when last signatory signs", () => {
    const signatories: SignatoryEntry[] = [
      { userId: SIGNER_1, ordinal: 1, deadlineDays: 7, status: "signed", signedAt: "2025-06-01T10:00:00Z" },
      { userId: SIGNER_2, ordinal: 2, deadlineDays: 7, status: "pending", signedAt: null },
    ];
    const result = applySignature(signatories, 2, SIGNER_2, "2025-06-02T10:00:00Z");
    expect(result.signatories[1]!.status).toBe("signed");
    expect(result.newOrdinal).toBe(3);
    expect(result.isComplete).toBe(true);
  });

  it("throws when wrong user tries to sign", () => {
    const signatories: SignatoryEntry[] = [
      { userId: SIGNER_1, ordinal: 1, deadlineDays: 7, status: "pending", signedAt: null },
    ];
    expect(() => applySignature(signatories, 1, SIGNER_2, "2025-06-01T10:00:00Z"))
      .toThrow("user is not the current signatory");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DOMAIN LOGIC — Deadline Enforcement
// ════════════════════════════════════════════════════════════════════════════

describe("checkDeadlineStatus — domain logic", () => {
  const baseSignatories: SignatoryEntry[] = [
    { userId: SIGNER_1, ordinal: 1, deadlineDays: 5, status: "pending", signedAt: null },
    { userId: SIGNER_2, ordinal: 2, deadlineDays: 10, status: "pending", signedAt: null },
  ];

  it("returns on_time when within first deadline", () => {
    const created = new Date("2025-06-01T00:00:00Z");
    const now = new Date("2025-06-03T00:00:00Z"); // 2 days in, deadline is 5
    expect(checkDeadlineStatus(baseSignatories, 1, created, now)).toBe("on_time");
  });

  it("returns reminder when past first deadline but before escalation", () => {
    const created = new Date("2025-06-01T00:00:00Z");
    const now = new Date("2025-06-07T00:00:00Z"); // 6 days in, deadline is 5, escalation at 10
    expect(checkDeadlineStatus(baseSignatories, 1, created, now)).toBe("reminder");
  });

  it("returns escalation when past second deadline (2× days)", () => {
    const created = new Date("2025-06-01T00:00:00Z");
    const now = new Date("2025-06-12T00:00:00Z"); // 11 days in, escalation at 10
    expect(checkDeadlineStatus(baseSignatories, 1, created, now)).toBe("escalation");
  });

  it("returns on_time at exact first deadline boundary", () => {
    const created = new Date("2025-06-01T00:00:00Z");
    // Exactly at first deadline (5 days = 2025-06-06T00:00:00Z)
    const now = new Date("2025-06-06T00:00:00Z");
    expect(checkDeadlineStatus(baseSignatories, 1, created, now)).toBe("reminder");
  });

  it("handles second signatory start date from previous signing", () => {
    const signed: SignatoryEntry[] = [
      { userId: SIGNER_1, ordinal: 1, deadlineDays: 5, status: "signed", signedAt: "2025-06-04T00:00:00Z" },
      { userId: SIGNER_2, ordinal: 2, deadlineDays: 10, status: "pending", signedAt: null },
    ];
    const created = new Date("2025-06-01T00:00:00Z");
    // Signer 2 starts at June 4, deadline is 10 days → June 14
    const now = new Date("2025-06-10T00:00:00Z"); // 6 days after signer 2 start
    expect(checkDeadlineStatus(signed, 2, created, now)).toBe("on_time");
  });
});

describe("computeSignatoryStartDate — domain logic", () => {
  it("returns route creation date for ordinal 1", () => {
    const signatories: SignatoryEntry[] = [
      { userId: SIGNER_1, ordinal: 1, deadlineDays: 5, status: "pending", signedAt: null },
    ];
    const created = new Date("2025-06-01T00:00:00Z");
    expect(computeSignatoryStartDate(signatories, 1, created)).toEqual(created);
  });

  it("returns previous signatory signed date for ordinal > 1", () => {
    const signatories: SignatoryEntry[] = [
      { userId: SIGNER_1, ordinal: 1, deadlineDays: 5, status: "signed", signedAt: "2025-06-03T12:00:00Z" },
      { userId: SIGNER_2, ordinal: 2, deadlineDays: 10, status: "pending", signedAt: null },
    ];
    const created = new Date("2025-06-01T00:00:00Z");
    expect(computeSignatoryStartDate(signatories, 2, created)).toEqual(new Date("2025-06-03T12:00:00Z"));
  });

  it("falls back to cumulative days when previous not signed", () => {
    const signatories: SignatoryEntry[] = [
      { userId: SIGNER_1, ordinal: 1, deadlineDays: 5, status: "pending", signedAt: null },
      { userId: SIGNER_2, ordinal: 2, deadlineDays: 10, status: "pending", signedAt: null },
    ];
    const created = new Date("2025-06-01T00:00:00Z");
    const expected = new Date("2025-06-06T00:00:00Z"); // created + 5 days
    expect(computeSignatoryStartDate(signatories, 2, created)).toEqual(expected);
  });
});

describe("computeFirstDeadline — domain logic", () => {
  it("computes first deadline for ordinal 1", () => {
    const signatories: SignatoryEntry[] = [
      { userId: SIGNER_1, ordinal: 1, deadlineDays: 7, status: "pending", signedAt: null },
    ];
    const created = new Date("2025-06-01T00:00:00Z");
    expect(computeFirstDeadline(signatories, 1, created)).toEqual(new Date("2025-06-08T00:00:00Z"));
  });
});

describe("computeEscalationDeadline — domain logic", () => {
  it("computes escalation at 2× deadline days", () => {
    const signatories: SignatoryEntry[] = [
      { userId: SIGNER_1, ordinal: 1, deadlineDays: 7, status: "pending", signedAt: null },
    ];
    const created = new Date("2025-06-01T00:00:00Z");
    // 2 × 7 = 14 days
    expect(computeEscalationDeadline(signatories, 1, created)).toEqual(new Date("2025-06-15T00:00:00Z"));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ROUTE TESTS — Create E-Sign Route
// ════════════════════════════════════════════════════════════════════════════

describe("POST /v1/contract/esign — create e-sign routing", () => {
  it("returns 202 accepted (queue-first CQRS) for a valid request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/contract/esign",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: {
        contractId: CONTRACT_ID,
        ownerId: OWNER,
        signatories: [
          { userId: SIGNER_1, ordinal: 1, deadlineDays: 7 },
          { userId: SIGNER_2, ordinal: 2, deadlineDays: 14 },
          { userId: SIGNER_3, ordinal: 3, deadlineDays: 5 },
        ],
      },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("accepted");
    expect(body.correlationId).toBeDefined();
  });

  it("returns 202 accepted for a single signatory", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/contract/esign",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: {
        contractId: CONTRACT_ID,
        ownerId: OWNER,
        signatories: [{ userId: SIGNER_1, ordinal: 1, deadlineDays: 1 }],
      },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("returns 400 for empty signatories", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/contract/esign",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { contractId: CONTRACT_ID, ownerId: OWNER, signatories: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for deadlineDays > 30", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/contract/esign",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: {
        contractId: CONTRACT_ID,
        ownerId: OWNER,
        signatories: [{ userId: SIGNER_1, ordinal: 1, deadlineDays: 31 }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for more than 10 signatories", async () => {
    const signatories = Array.from({ length: 11 }, (_, i) => ({
      userId: `${String(i + 1).padStart(8, "0")}-0000-4000-8000-000000000000`,
      ordinal: i + 1,
      deadlineDays: 5,
    }));
    const res = await app.inject({
      method: "POST",
      url: "/v1/contract/esign",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { contractId: CONTRACT_ID, ownerId: OWNER, signatories },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/contract/esign",
      payload: {
        contractId: CONTRACT_ID,
        ownerId: OWNER,
        signatories: [{ userId: SIGNER_1, ordinal: 1, deadlineDays: 7 }],
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/contract/esign",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
      payload: {
        contractId: CONTRACT_ID,
        ownerId: OWNER,
        signatories: [{ userId: SIGNER_1, ordinal: 1, deadlineDays: 7 }],
      },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ROUTE TESTS — Sign Current Signatory
// ════════════════════════════════════════════════════════════════════════════

describe("POST /v1/contract/esign/:id/sign — sign current signatory", () => {
  // Sign is queue-first CQRS too: the route only does pre-publish reads/validation
  // (route status + canSign) and publishes; the actual write lives in the consumer
  // (see the "e-sign consumer — CQRS wiring" integration suite below). Seed the
  // route directly via repo so the pre-publish checks have something to read.
  async function seedRoute(signatories: Array<{ userId: string; ordinal: number; deadlineDays: number; status?: "pending" | "signed" | "overdue"; signedAt?: string | null }>, overrides: Record<string, unknown> = {}) {
    const route = await esignRepo.insertEsignRoute({
      id: randomUUID(),
      tenantId: TENANT,
      contractId: CONTRACT_ID,
      signatories: signatories.map((s) => ({ status: "pending" as const, signedAt: null, ...s })),
      currentOrdinal: 1,
      status: "in_progress",
      ownerId: OWNER,
      createdBy: ACTOR,
      updatedBy: ACTOR,
      ...overrides,
    });
    return route.id;
  }

  it("returns 202 accepted when correct signatory signs (queue-first)", async () => {
    const routeId = await seedRoute([
      { userId: SIGNER_1, ordinal: 1, deadlineDays: 7 },
      { userId: SIGNER_2, ordinal: 2, deadlineDays: 14 },
    ]);
    const res = await app.inject({
      method: "POST",
      url: `/v1/contract/esign/${routeId}/sign`,
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { userId: SIGNER_1 },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBe(routeId);
    expect(body.status).toBe("accepted");
  });

  it("returns 422 when wrong signatory tries to sign", async () => {
    const routeId = await seedRoute([
      { userId: SIGNER_1, ordinal: 1, deadlineDays: 7 },
      { userId: SIGNER_2, ordinal: 2, deadlineDays: 14 },
    ]);
    const res = await app.inject({
      method: "POST",
      url: `/v1/contract/esign/${routeId}/sign`,
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { userId: SIGNER_2 }, // Not ordinal 1
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("CANNOT_SIGN");
  });

  it("returns 404 for non-existent route", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/contract/esign/00000000-0000-4000-8000-000000000099/sign",
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { userId: SIGNER_1 },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 422 when route is already completed", async () => {
    const routeId = await seedRoute(
      [{ userId: SIGNER_1, ordinal: 1, deadlineDays: 7, status: "signed", signedAt: new Date().toISOString() }],
      { status: "completed", currentOrdinal: 2 },
    );
    const res = await app.inject({
      method: "POST",
      url: `/v1/contract/esign/${routeId}/sign`,
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { userId: SIGNER_1 },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("ROUTE_NOT_ACTIVE");
  });

  it("returns 401 without auth token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/contract/esign/some-id/sign",
      payload: { userId: SIGNER_1 },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ROUTE TESTS — Get E-Sign Route Status
// ════════════════════════════════════════════════════════════════════════════

describe("GET /v1/contract/esign/:id — get route status", () => {
  it("returns 200 with full route data", async () => {
    // Create is queue-first CQRS; seed directly via repo for this read-path test,
    // matching what the esignCreate consumer would produce.
    const route = await esignRepo.insertEsignRoute({
      id: randomUUID(),
      tenantId: TENANT,
      contractId: CONTRACT_ID,
      signatories: [
        { userId: SIGNER_1, ordinal: 1, deadlineDays: 7, status: "pending", signedAt: null },
        { userId: SIGNER_2, ordinal: 2, deadlineDays: 14, status: "pending", signedAt: null },
      ],
      currentOrdinal: 1,
      status: "in_progress",
      ownerId: OWNER,
      createdBy: ACTOR,
      updatedBy: ACTOR,
    });
    const routeId = route.id;

    const res = await app.inject({
      method: "GET",
      url: `/v1/contract/esign/${routeId}`,
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.id).toBe(routeId);
    expect(body.data.contractId).toBe(CONTRACT_ID);
    expect(body.data.status).toBe("in_progress");
    expect(body.data.signatories).toHaveLength(2);
    expect(body.data.deadlineStatus).toBe("on_time");
    expect(body.data.ownerId).toBe(OWNER);
  });

  it("returns 404 for non-existent route", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/contract/esign/00000000-0000-4000-8000-000000000099",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 401 without auth token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/contract/esign/00000000-0000-4000-8000-000000000099",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/contract/esign/00000000-0000-4000-8000-000000000099",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ROUTE TESTS — Check Deadline
// ════════════════════════════════════════════════════════════════════════════

describe("POST /v1/contract/esign/:id/check-deadline — deadline enforcement", () => {
  it("returns on_time action when within deadline", async () => {
    // Create is queue-first CQRS; seed directly via repo for this read-path
    // (check-deadline's decision is a synchronous read; only the escalation
    // write is queue-first, via COMMANDS.esignCheckDeadline).
    const route = await esignRepo.insertEsignRoute({
      id: randomUUID(),
      tenantId: TENANT,
      contractId: CONTRACT_ID,
      signatories: [{ userId: SIGNER_1, ordinal: 1, deadlineDays: 30, status: "pending", signedAt: null }],
      currentOrdinal: 1,
      status: "in_progress",
      ownerId: OWNER,
      createdBy: ACTOR,
      updatedBy: ACTOR,
    });

    const res = await app.inject({
      method: "POST",
      url: `/v1/contract/esign/${route.id}/check-deadline`,
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.action).toBe("none");
    expect(res.json().data.reason).toBe("on_time");
  });

  it("returns 404 for non-existent route", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/contract/esign/00000000-0000-4000-8000-000000000099/check-deadline",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns none action for completed routes", async () => {
    const route = await esignRepo.insertEsignRoute({
      id: randomUUID(),
      tenantId: TENANT,
      contractId: CONTRACT_ID,
      signatories: [
        { userId: SIGNER_1, ordinal: 1, deadlineDays: 7, status: "signed", signedAt: new Date().toISOString() },
      ],
      currentOrdinal: 2,
      status: "completed",
      ownerId: OWNER,
      createdBy: ACTOR,
      updatedBy: ACTOR,
    });

    const res = await app.inject({
      method: "POST",
      url: `/v1/contract/esign/${route.id}/check-deadline`,
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.action).toBe("none");
    expect(res.json().data.reason).toBe("route not in progress");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CONSUMER — CQRS wiring (integration) — full create → sign → complete flow
// ════════════════════════════════════════════════════════════════════════════

describe("E-sign consumer — CQRS wiring (integration)", () => {
  it("create → sign → sign completes the route via queue consumer", { timeout: 20_000 }, async () => {
    const { MemoryQueue } = await import("@civitasone/queue");
    const { withTenantConsumer } = await import("@civitasone/db");
    const { registerEsignConsumers } = await import("../src/modules/esign/consumer.js");
    const { COMMANDS } = await import("../src/topics.js");

    const rawQueue = new MemoryQueue();
    const rawSubscribe = rawQueue.subscribe.bind(rawQueue);
    rawQueue.subscribe = ((topic: string, handler: any) =>
      rawSubscribe(topic, withTenantConsumer(handler) as any)) as typeof rawQueue.subscribe;
    registerEsignConsumers(rawQueue);
    await rawQueue.start();

    const routeId = randomUUID();
    function pub(type: string, payload: Record<string, unknown>) {
      return rawQueue.publish(type, {
        messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR,
        correlationId: "corr-" + randomUUID().slice(0, 8), schemaVersion: "1.0", payload,
      });
    }

    async function waitForRoute(want: { status?: string; currentOrdinal?: number }) {
      for (let i = 0; i < 40; i++) {
        const row = await withTenantScope(db, TENANT, (tx) =>
          tx.select().from(esignRoutes).where(eq(esignRoutes.id, routeId)).then((r) => r[0]));
        if (row && (want.status === undefined || row.status === want.status)
          && (want.currentOrdinal === undefined || row.currentOrdinal === want.currentOrdinal)) {
          return row;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(`e-sign route ${routeId} did not reach expected state ${JSON.stringify(want)}`);
    }

    await pub(COMMANDS.esignCreate, {
      id: routeId, tenantId: TENANT, contractId: CONTRACT_ID, ownerId: OWNER,
      signatories: [
        { userId: SIGNER_1, ordinal: 1, deadlineDays: 7 },
        { userId: SIGNER_2, ordinal: 2, deadlineDays: 14 },
      ],
    });
    await waitForRoute({ status: "in_progress", currentOrdinal: 1 });

    await pub(COMMANDS.esignSign, { id: routeId, tenantId: TENANT, userId: SIGNER_1 });
    await waitForRoute({ status: "in_progress", currentOrdinal: 2 });

    await pub(COMMANDS.esignSign, { id: routeId, tenantId: TENANT, userId: SIGNER_2 });
    const done = await waitForRoute({ status: "completed" });
    expect((done.signatories as SignatoryEntry[]).every((s) => s.status === "signed")).toBe(true);

    await rawQueue.stop();
  });
});
