/**
 * Regression: CQRS wiring for the obligations module.
 *
 * Mock-based approach — no real database connection needed (mirrors the
 * milestone/bond and catalogue-service CQRS route-test pattern).
 *
 * Asserts that POST/PATCH on /v1/contract/obligations:
 *   - publish to the correct COMMANDS.* topic (queue-first)
 *   - return 202 Accepted with the standard { id, status, correlationId } shape
 *   - never call repo.insertObligation / updateObligation directly
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-9999-4000-8000-000000000042";
const ACTOR = "00000000-0001-4000-8000-000000000042";
const CONTRACT_ID = "22222222-3333-4000-8000-000000000042";
const OBLIGATION_ID = "11111111-2222-4000-8000-000000000042";
const NON_EXISTENT_ID = "00000000-0000-4000-8000-000000000099";

const H = vi.hoisted(() => ({
  publishMock: vi.fn(),
  invalidateMock: vi.fn(),
  getObligationByIdMock: vi.fn(),
  listObligationsMock: vi.fn(),
  getRemindersForObligationMock: vi.fn(),
  insertObligationMock: vi.fn(),
  insertRemindersMock: vi.fn(),
  updateObligationMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({}) },
  sqlClient: { end: async () => {} },
  scopedRead: (fn: (tx: unknown) => Promise<unknown>) => fn({}),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    invalidate: (...a: unknown[]) => H.invalidateMock(...a),
    makeKey: (...a: string[]) => a.join(":"),
  },
  queue: { publish: (...a: unknown[]) => H.publishMock(...a) },
}));

vi.mock("../src/modules/obligations/repo.js", () => ({
  getObligationById: (...a: unknown[]) => H.getObligationByIdMock(...a),
  listObligations: (...a: unknown[]) => H.listObligationsMock(...a),
  getRemindersForObligation: (...a: unknown[]) => H.getRemindersForObligationMock(...a),
  insertObligation: (...a: unknown[]) => H.insertObligationMock(...a),
  insertReminders: (...a: unknown[]) => H.insertRemindersMock(...a),
  updateObligation: (...a: unknown[]) => H.updateObligationMock(...a),
}));

import { buildApp } from "../src/app.js";
import { COMMANDS } from "../src/topics.js";

function makeObligation(overrides: Record<string, unknown> = {}) {
  return {
    id: OBLIGATION_ID,
    tenantId: TENANT,
    contractId: CONTRACT_ID,
    title: "Deliver Phase 1 Report",
    description: "Monthly progress report delivery",
    dueDate: "2026-06-01",
    status: "pending",
    ownerId: ACTOR,
    createdBy: ACTOR,
    updatedBy: ACTOR,
    version: 1,
    ...overrides,
  };
}

function adminToken(roles: string[] = ["super_admin"]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-obligations-cqrs" }, SECRET);
}

beforeEach(() => {
  vi.clearAllMocks();
  H.getObligationByIdMock.mockResolvedValue(makeObligation());
  H.listObligationsMock.mockResolvedValue({ data: [makeObligation()], total: 1 });
  H.getRemindersForObligationMock.mockResolvedValue([]);
  H.publishMock.mockResolvedValue(undefined);
  H.invalidateMock.mockResolvedValue(undefined);
});

describe("POST /v1/contract/obligations — queue-first CQRS", () => {
  it("publishes contract.obligation.create and returns 202 accepted", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/contract/obligations",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        contractId: CONTRACT_ID,
        title: "Deliver Phase 1 Report",
        description: "Monthly progress report delivery",
        dueDate: "2026-06-01",
        ownerId: ACTOR,
      },
    });
    await app.close();

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe("accepted");
    expect(body.id).toBeDefined();
    expect(body.correlationId).toBeDefined();

    expect(H.publishMock).toHaveBeenCalledTimes(1);
    const [topic, msg] = H.publishMock.mock.calls[0]!;
    expect(topic).toBe(COMMANDS.obligationCreate);
    expect(msg.payload).toMatchObject({
      tenantId: TENANT, contractId: CONTRACT_ID, title: "Deliver Phase 1 Report", dueDate: "2026-06-01",
    });

    // Route must not touch the write side of the repo directly — the
    // consumer (not the route) is responsible for the insert + reminders.
    expect(H.insertObligationMock).not.toHaveBeenCalled();
    expect(H.insertRemindersMock).not.toHaveBeenCalled();
  });

  it("returns 400 for missing required fields without publishing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/contract/obligations",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { title: "Incomplete" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
    expect(H.publishMock).not.toHaveBeenCalled();
  });

  it("returns 401 without auth token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/contract/obligations",
      payload: { contractId: CONTRACT_ID, title: "Test", dueDate: "2026-01-01", ownerId: ACTOR },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
    expect(H.publishMock).not.toHaveBeenCalled();
  });

  it("returns 403 for unauthorized role without publishing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/contract/obligations",
      headers: { authorization: `Bearer ${adminToken(["citizen"])}` },
      payload: { contractId: CONTRACT_ID, title: "Test", dueDate: "2026-01-01", ownerId: ACTOR },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
    expect(H.publishMock).not.toHaveBeenCalled();
  });
});

describe("PATCH /v1/contract/obligations/:id — queue-first CQRS", () => {
  it("publishes contract.obligation.update and returns 202 accepted", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/contract/obligations/${OBLIGATION_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { status: "in_progress", version: 1 },
    });
    await app.close();

    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");

    expect(H.publishMock).toHaveBeenCalledTimes(1);
    const [topic, msg] = H.publishMock.mock.calls[0]!;
    expect(topic).toBe(COMMANDS.obligationUpdate);
    expect(msg.payload).toMatchObject({ id: OBLIGATION_ID, tenantId: TENANT, version: 1, status: "in_progress" });

    expect(H.updateObligationMock).not.toHaveBeenCalled();
  });

  it("returns 404 for non-existent obligation without publishing", async () => {
    H.getObligationByIdMock.mockResolvedValue(undefined);
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/contract/obligations/${NON_EXISTENT_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { status: "in_progress", version: 1 },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
    expect(H.publishMock).not.toHaveBeenCalled();
  });

  it("returns 422 for invalid status transition without publishing", async () => {
    H.getObligationByIdMock.mockResolvedValue(makeObligation({ status: "completed" }));
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/contract/obligations/${OBLIGATION_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { status: "pending", version: 1 },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_TRANSITION");
    expect(H.publishMock).not.toHaveBeenCalled();
    expect(H.updateObligationMock).not.toHaveBeenCalled();
  });
});

describe("GET /v1/contract/obligations — unaffected sync read", () => {
  it("returns 200 with data and meta (reads stay synchronous)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/contract/obligations",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta.total).toBe(1);
    expect(H.publishMock).not.toHaveBeenCalled();
  });
});
