/**
 * Regression: CQRS wiring for the approvals module.
 *
 * Mock-based approach — no real database connection needed (mirrors the
 * milestone/bond and catalogue-service CQRS route-test pattern).
 *
 * Asserts that POST/PATCH/DELETE on /v1/contract/approval-levels:
 *   - publish to the correct COMMANDS.* topic (queue-first)
 *   - return 202 Accepted with the standard { id, status, correlationId } shape
 *   - never call repo.insertApprovalLevel / updateApprovalLevel / deleteApprovalLevel directly
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-9999-4000-8000-000000000041";
const ACTOR = "00000000-0001-4000-8000-000000000041";
const LEVEL_ID = "11111111-2222-4000-8000-000000000041";
const NON_EXISTENT_ID = "00000000-0000-4000-8000-000000000099";

const H = vi.hoisted(() => ({
  publishMock: vi.fn(),
  invalidateMock: vi.fn(),
  countApprovalLevelsMock: vi.fn(),
  getApprovalLevelByIdMock: vi.fn(),
  listApprovalLevelsMock: vi.fn(),
  insertApprovalLevelMock: vi.fn(),
  updateApprovalLevelMock: vi.fn(),
  deleteApprovalLevelMock: vi.fn(),
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

vi.mock("../src/modules/approvals/repo.js", () => ({
  countApprovalLevels: (...a: unknown[]) => H.countApprovalLevelsMock(...a),
  getApprovalLevelById: (...a: unknown[]) => H.getApprovalLevelByIdMock(...a),
  listApprovalLevels: (...a: unknown[]) => H.listApprovalLevelsMock(...a),
  insertApprovalLevel: (...a: unknown[]) => H.insertApprovalLevelMock(...a),
  updateApprovalLevel: (...a: unknown[]) => H.updateApprovalLevelMock(...a),
  deleteApprovalLevel: (...a: unknown[]) => H.deleteApprovalLevelMock(...a),
}));

import { buildApp } from "../src/app.js";
import { COMMANDS } from "../src/topics.js";

function makeLevel(overrides: Record<string, unknown> = {}) {
  return {
    id: LEVEL_ID,
    tenantId: TENANT,
    minValuePaise: 100000n,
    requiredRole: "manager",
    label: "Low value",
    ordinal: 1,
    createdBy: ACTOR,
    updatedBy: ACTOR,
    version: 1,
    ...overrides,
  };
}

function adminToken(roles: string[] = ["super_admin"]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-approvals-cqrs" }, SECRET);
}

beforeEach(() => {
  vi.clearAllMocks();
  H.countApprovalLevelsMock.mockResolvedValue(0);
  H.getApprovalLevelByIdMock.mockResolvedValue(makeLevel());
  H.listApprovalLevelsMock.mockResolvedValue({ data: [makeLevel()], total: 1 });
  H.publishMock.mockResolvedValue(undefined);
  H.invalidateMock.mockResolvedValue(undefined);
});

describe("POST /v1/contract/approval-levels — queue-first CQRS", () => {
  it("publishes contract.approval_level.create and returns 202 accepted", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/contract/approval-levels",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { minValuePaise: "100000", requiredRole: "manager", label: "Low value" },
    });
    await app.close();

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe("accepted");
    expect(body.id).toBeDefined();
    expect(body.correlationId).toBeDefined();

    expect(H.publishMock).toHaveBeenCalledTimes(1);
    const [topic, msg] = H.publishMock.mock.calls[0]!;
    expect(topic).toBe(COMMANDS.approvalLevelCreate);
    expect(msg.payload).toMatchObject({ tenantId: TENANT, minValuePaise: "100000", requiredRole: "manager", ordinal: 1 });

    // Route must not touch the write side of the repo directly.
    expect(H.insertApprovalLevelMock).not.toHaveBeenCalled();
  });

  it("returns 422 when max approval levels reached (pre-publish read, no publish)", async () => {
    H.countApprovalLevelsMock.mockResolvedValue(5);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/contract/approval-levels",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { minValuePaise: "600000", requiredRole: "overflow" },
    });
    await app.close();

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("LEVEL_LIMIT_REACHED");
    expect(H.publishMock).not.toHaveBeenCalled();
    expect(H.insertApprovalLevelMock).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid body without publishing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/contract/approval-levels",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { minValuePaise: "not-a-number", requiredRole: "manager" },
    });
    await app.close();

    expect(res.statusCode).toBe(400);
    expect(H.publishMock).not.toHaveBeenCalled();
  });

  it("returns 401 without auth token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/contract/approval-levels",
      payload: { minValuePaise: "100000", requiredRole: "manager" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
    expect(H.publishMock).not.toHaveBeenCalled();
  });

  it("returns 403 for unauthorized role without publishing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/contract/approval-levels",
      headers: { authorization: `Bearer ${adminToken(["citizen"])}` },
      payload: { minValuePaise: "100000", requiredRole: "manager" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
    expect(H.publishMock).not.toHaveBeenCalled();
  });
});

describe("PATCH /v1/contract/approval-levels/:id — queue-first CQRS", () => {
  it("publishes contract.approval_level.update and returns 202 accepted", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/contract/approval-levels/${LEVEL_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { requiredRole: "director", version: 1 },
    });
    await app.close();

    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");

    expect(H.publishMock).toHaveBeenCalledTimes(1);
    const [topic, msg] = H.publishMock.mock.calls[0]!;
    expect(topic).toBe(COMMANDS.approvalLevelUpdate);
    expect(msg.payload).toMatchObject({ id: LEVEL_ID, tenantId: TENANT, version: 1, requiredRole: "director" });

    expect(H.updateApprovalLevelMock).not.toHaveBeenCalled();
  });

  it("returns 404 for non-existent level without publishing", async () => {
    H.getApprovalLevelByIdMock.mockResolvedValue(undefined);
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/contract/approval-levels/${NON_EXISTENT_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { requiredRole: "director", version: 1 },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
    expect(H.publishMock).not.toHaveBeenCalled();
  });
});

describe("DELETE /v1/contract/approval-levels/:id — queue-first CQRS", () => {
  it("publishes contract.approval_level.delete and returns 202 accepted", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/contract/approval-levels/${LEVEL_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");

    expect(H.publishMock).toHaveBeenCalledTimes(1);
    const [topic, msg] = H.publishMock.mock.calls[0]!;
    expect(topic).toBe(COMMANDS.approvalLevelDelete);
    expect(msg.payload).toMatchObject({ id: LEVEL_ID, tenantId: TENANT });

    expect(H.deleteApprovalLevelMock).not.toHaveBeenCalled();
  });

  it("returns 404 for non-existent level without publishing", async () => {
    H.getApprovalLevelByIdMock.mockResolvedValue(undefined);
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/contract/approval-levels/${NON_EXISTENT_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
    expect(H.publishMock).not.toHaveBeenCalled();
  });
});
