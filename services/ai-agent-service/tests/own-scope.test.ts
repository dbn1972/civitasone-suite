/**
 * Security: conversations and copilot turns are personal. A plain ai_user sees
 * and acts on its own only; ai_admin / super_admin keep tenant-wide access.
 * Route-level, repo mocked (same pattern as ai-agent-routes.test.ts); a non-owner
 * gets 404 so another user's conversation ids are not even confirmable.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const OWNER = "aaaaaaaa-1111-4000-8000-000000000001";
const OTHER = "aaaaaaaa-2222-4000-8000-000000000002";
const CONV_ID = "cccccccc-1111-4000-8000-000000000001";
const TURN_ID = "dddddddd-1111-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  publishMock: vi.fn(),
  dbTransactionMock: vi.fn(),
  scopedReadMock: vi.fn(),
  enqueueMock: vi.fn(),
  chatFindByIdMock: vi.fn(),
  chatListMock: vi.fn(),
  chatListMessagesMock: vi.fn(),
  copilotFindByIdMock: vi.fn(),
  copilotListMock: vi.fn(),
  ruleListActiveMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => H.dbTransactionMock(cb) },
  scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => H.scopedReadMock(fn),
  sqlClient: { end: async () => {} },
}));
vi.mock("../src/shared/outbox.js", () => ({ enqueue: (...a: unknown[]) => H.enqueueMock(...a) }));
vi.mock("../src/shared/infra.js", () => ({
  cache: { getOrLoad: vi.fn(), invalidate: vi.fn(), invalidateResource: vi.fn(), makeKey: vi.fn(() => "k") },
  queue: { publish: (...a: unknown[]) => H.publishMock(...a) },
}));
vi.mock("../src/modules/chat/repo.js", () => ({
  findById: (...a: unknown[]) => H.chatFindByIdMock(...a),
  listByTenant: (...a: unknown[]) => H.chatListMock(...a),
  insert: vi.fn(), update: vi.fn(), insertMessage: vi.fn(),
  listMessages: (...a: unknown[]) => H.chatListMessagesMock(...a),
  toView: (r: Record<string, unknown>) => r,
  toMessageView: (r: Record<string, unknown>) => r,
}));
vi.mock("../src/modules/copilot/repo.js", () => ({
  findById: (...a: unknown[]) => H.copilotFindByIdMock(...a),
  listByTenant: (...a: unknown[]) => H.copilotListMock(...a),
  insert: vi.fn(), update: vi.fn(),
  toView: (r: Record<string, unknown>) => r,
}));
vi.mock("../src/modules/guardrails/repo.js", () => ({
  listActive: (...a: unknown[]) => H.ruleListActiveMock(...a),
  findById: vi.fn(), listByTenant: vi.fn(), insert: vi.fn(), update: vi.fn(), softDelete: vi.fn(),
  toView: (r: Record<string, unknown>) => r,
}));

import { buildApp } from "../src/app.js";

const auth = (sub: string, roles: string[]) => ({
  authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET)}`,
});
const conv = (over: Record<string, unknown> = {}) => ({
  id: CONV_ID, tenantId: TENANT, channelId: CONV_ID, profileId: CONV_ID, status: "active", language: "en",
  startedAt: new Date(), endedAt: null, createdAt: new Date(), updatedAt: new Date(),
  createdBy: OWNER, updatedBy: OWNER, version: 1, ...over,
});
const turn = () => ({
  id: TURN_ID, tenantId: TENANT, userId: OWNER, prompt: "p", response: null, sourceCitations: [],
  model: null, tokens: null, latencyMs: 10, createdAt: new Date(), updatedAt: new Date(),
  createdBy: OWNER, updatedBy: OWNER, version: 1,
});

beforeEach(() => {
  vi.clearAllMocks();
  H.publishMock.mockResolvedValue(undefined);
  H.dbTransactionMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb({}));
  H.enqueueMock.mockResolvedValue(undefined);
  H.ruleListActiveMock.mockResolvedValue([]);
  H.chatFindByIdMock.mockResolvedValue(conv());
  H.chatListMock.mockResolvedValue({ rows: [], total: 0 });
  H.chatListMessagesMock.mockResolvedValue({ rows: [], total: 0 });
  H.copilotFindByIdMock.mockResolvedValue(turn());
  H.copilotListMock.mockResolvedValue({ rows: [], total: 0 });
});

describe("chat conversations are owner-scoped", () => {
  const routes: Array<[string, string, unknown?]> = [
    ["GET", `/v1/ai/chat/${CONV_ID}`],
    ["GET", `/v1/ai/chat/${CONV_ID}/history`],
    ["POST", `/v1/ai/chat/${CONV_ID}/end`, { version: 1 }],
    ["POST", `/v1/ai/chat/${CONV_ID}/handoff`, { version: 1, reasonCode: "agent_initiated" }],
  ];

  for (const [method, url, payload] of routes) {
    it(`${method} ${url.replace(CONV_ID, ":id")} -> 404 for a different ai_user, nothing published`, async () => {
      const app = await buildApp();
      const r = await app.inject({ method: method as "GET" | "POST", url, headers: auth(OTHER, ["ai_user"]), ...(payload ? { payload } : {}) });
      await app.close();
      expect(r.statusCode).toBe(404);
      expect(H.publishMock).not.toHaveBeenCalled();
    });

    it(`${method} ${url.replace(CONV_ID, ":id")} -> allowed for the owner`, async () => {
      const app = await buildApp();
      const r = await app.inject({ method: method as "GET" | "POST", url, headers: auth(OWNER, ["ai_user"]), ...(payload ? { payload } : {}) });
      await app.close();
      expect([200, 202]).toContain(r.statusCode);
    });

    it(`${method} ${url.replace(CONV_ID, ":id")} -> allowed for ai_admin on someone else's conversation`, async () => {
      const app = await buildApp();
      const r = await app.inject({ method: method as "GET" | "POST", url, headers: auth(OTHER, ["ai_admin"]), ...(payload ? { payload } : {}) });
      await app.close();
      expect([200, 202]).toContain(r.statusCode);
    });
  }

  it("super_admin keeps tenant-wide access", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/ai/chat/${CONV_ID}`, headers: auth(OTHER, ["super_admin"]) });
    await app.close();
    expect(r.statusCode).toBe(200);
  });

  it("POST /v1/ai/chat cannot continue another user's conversation", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/ai/chat", headers: auth(OTHER, ["ai_user"]),
      payload: { conversationId: CONV_ID, message: "hi", channelId: CONV_ID, profileId: CONV_ID },
    });
    await app.close();
    expect(r.statusCode).toBe(404);
    expect(H.publishMock).not.toHaveBeenCalled();
  });

  it("GET /v1/ai/chat list is forced to the caller's own conversations for ai_user", async () => {
    const app = await buildApp();
    await app.inject({ method: "GET", url: "/v1/ai/chat", headers: auth(OTHER, ["ai_user"]) });
    await app.close();
    expect(H.chatListMock.mock.calls[0]![3]).toMatchObject({ createdBy: OTHER });
  });

  it("GET /v1/ai/chat list is tenant-wide (no createdBy filter) for ai_admin", async () => {
    const app = await buildApp();
    await app.inject({ method: "GET", url: "/v1/ai/chat", headers: auth(OTHER, ["ai_admin"]) });
    await app.close();
    expect(H.chatListMock.mock.calls[0]![3]).not.toHaveProperty("createdBy");
  });
});

describe("copilot turns are owner-scoped", () => {
  it("GET /turns/:id -> 404 for a different ai_user, 200 for owner and ai_admin", async () => {
    const app = await buildApp();
    const url = `/v1/ai/copilot/turns/${TURN_ID}`;
    expect((await app.inject({ method: "GET", url, headers: auth(OTHER, ["ai_user"]) })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url, headers: auth(OWNER, ["ai_user"]) })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url, headers: auth(OTHER, ["ai_admin"]) })).statusCode).toBe(200);
    await app.close();
  });

  it("GET /turns forces userId = caller for ai_user even when another userId is requested", async () => {
    const app = await buildApp();
    await app.inject({ method: "GET", url: `/v1/ai/copilot/turns?userId=${OWNER}`, headers: auth(OTHER, ["ai_user"]) });
    await app.close();
    expect(H.copilotListMock.mock.calls[0]![3]).toEqual({ userId: OTHER });
  });

  it("GET /turns honours the userId filter for ai_admin", async () => {
    const app = await buildApp();
    await app.inject({ method: "GET", url: `/v1/ai/copilot/turns?userId=${OWNER}`, headers: auth(OTHER, ["ai_admin"]) });
    await app.close();
    expect(H.copilotListMock.mock.calls[0]![3]).toEqual({ userId: OWNER });
  });
});
