/**
 * AG-005 open agent-interoperability protocols — domain + route tests.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import {
  buildCapabilityDescriptor,
  normalizeCapabilities,
  validateEndpoint,
  validateProtocol,
  PROTOCOLS,
} from "../src/modules/protocols/domain.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const REG_ID = "66666666-1111-4000-8000-000000000001";

// ── DOMAIN ────────────────────────────────────────────────────────────────────

describe("validateProtocol", () => {
  it("accepts every supported protocol", () => {
    for (const p of PROTOCOLS) expect(validateProtocol(p)).toBeNull();
  });

  it("rejects anything else", () => {
    expect(validateProtocol("soap")).toContain("must be one of");
    expect(validateProtocol("")).toContain("must be one of");
  });
});

describe("validateEndpoint", () => {
  it("accepts https", () => {
    expect(validateEndpoint("https://tools.example.gov.in/mcp")).toBeNull();
  });

  it("accepts http only for loopback", () => {
    expect(validateEndpoint("http://localhost:9000/mcp")).toBeNull();
    expect(validateEndpoint("http://127.0.0.1:9000/mcp")).toBeNull();
  });

  it("rejects plain http to a remote host", () => {
    expect(validateEndpoint("http://tools.example.com/mcp")).toContain("must use https");
  });

  it("rejects a non-URL, empty or non-string endpoint", () => {
    expect(validateEndpoint("not a url")).toContain("absolute URL");
    expect(validateEndpoint("")).toContain("required");
    expect(validateEndpoint("   ")).toContain("required");
    expect(validateEndpoint(undefined)).toContain("required");
    expect(validateEndpoint(42)).toContain("required");
  });

  it("rejects an over-long endpoint", () => {
    expect(validateEndpoint(`https://x.example.com/${"a".repeat(500)}`)).toContain("at most 500");
  });

  it("rejects non-http schemes", () => {
    expect(validateEndpoint("ftp://files.example.com/tools")).toContain("must use https");
  });
});

describe("normalizeCapabilities", () => {
  it("returns an empty list for non-array input", () => {
    expect(normalizeCapabilities(undefined)).toEqual([]);
    expect(normalizeCapabilities({ name: "x" })).toEqual([]);
  });

  it("drops nameless and malformed entries", () => {
    expect(normalizeCapabilities([{ description: "x" }, "tool", null, [1], { name: "  " }])).toEqual([]);
  });

  it("dedupes by name, first occurrence wins", () => {
    const out = normalizeCapabilities([
      { name: "Search", description: "first" },
      { name: "search", description: "second" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ name: "Search", description: "first", version: null });
  });

  it("normalises optional fields to null", () => {
    expect(normalizeCapabilities([{ name: "a", version: 3 }])).toEqual([
      { name: "a", description: null, version: null },
    ]);
  });
});

describe("buildCapabilityDescriptor", () => {
  it("describes an MCP registration", () => {
    const d = buildCapabilityDescriptor({
      protocol: "mcp",
      endpoint: "https://tools.example.gov.in/mcp",
      enabled: true,
      capabilities: [{ name: "search" }, { name: "fetch" }],
    });
    expect(d).toMatchObject({
      protocol: "mcp", transport: "jsonrpc", discovery: "tools/list", streaming: true, capabilityCount: 2,
    });
  });

  it("describes non-streaming tool-schema protocols", () => {
    expect(buildCapabilityDescriptor({
      protocol: "openai_tools", endpoint: "https://x.example.com", enabled: false, capabilities: [],
    })).toMatchObject({ streaming: false, discovery: "tools-schema", capabilityCount: 0, enabled: false });
  });

  it("falls back to mcp traits for an unknown protocol value", () => {
    expect(buildCapabilityDescriptor({
      protocol: "gibberish", endpoint: "https://x.example.com", enabled: true, capabilities: null,
    }).protocol).toBe("mcp");
  });
});

// ── ROUTES ────────────────────────────────────────────────────────────────────

const H = vi.hoisted(() => ({
  dbTransactionMock: vi.fn(),
  scopedReadMock: vi.fn(),
  enqueueMock: vi.fn(),
  auditInsertMock: vi.fn(),
  findByIdMock: vi.fn(),
  listMock: vi.fn(),
  insertMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => H.dbTransactionMock(cb) },
  scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => H.scopedReadMock(fn),
  sqlClient: { end: async () => {} },
}));

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: (...a: unknown[]) => H.enqueueMock(...a),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: vi.fn(async (_k: string, loader: () => Promise<unknown>) => loader()),
    invalidate: vi.fn(),
    invalidateResource: vi.fn(),
    makeKey: (t: string, resource: string, id: string) => `ai-agent:${t}:${resource}:${id}`,
  },
  queue: { publish: vi.fn() },
}));

vi.mock("../src/modules/protocols/repo.js", () => ({
  findById: (...a: unknown[]) => H.findByIdMock(...a),
  listByTenant: (...a: unknown[]) => H.listMock(...a),
  insert: (...a: unknown[]) => H.insertMock(...a),
  update: (...a: unknown[]) => H.updateMock(...a),
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/governance/repo.js", () => ({
  insert: (...a: unknown[]) => H.auditInsertMock(...a),
  findById: vi.fn(), listByTenant: vi.fn(), countTotals: vi.fn(),
  blockedCountsByAgent: vi.fn(async () => ({})),
  toView: (r: Record<string, unknown>) => r,
}));

const { buildApp } = await import("../src/app.js");

const auth = (sub = USER, roles = ["ai_admin"]) => ({
  authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET)}`,
});

function makeRegistration(over: Record<string, unknown> = {}) {
  return {
    id: REG_ID, tenantId: TENANT, protocol: "mcp", endpoint: "https://tools.example.gov.in/mcp",
    capabilities: [{ name: "search", description: null, version: null }], enabled: true,
    createdAt: new Date(), updatedAt: new Date(), createdBy: USER, updatedBy: USER, version: 1,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.dbTransactionMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb({}));
  H.enqueueMock.mockResolvedValue(undefined);
  H.auditInsertMock.mockResolvedValue(undefined);
  H.listMock.mockResolvedValue({ rows: [], total: 0 });
  H.insertMock.mockResolvedValue(undefined);
  H.updateMock.mockResolvedValue(true);
});

describe("GET /v1/ai/protocols", () => {
  it("200 — paginated list", async () => {
    H.listMock.mockResolvedValue({ rows: [makeRegistration()], total: 1 });
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/ai/protocols", headers: auth(USER, ["ai_user"]) });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    expect(r.json().meta).toEqual({ page: 1, pageSize: 50, total: 1 });
    await app.close();
  });

  it("200 — filters by protocol and enabled", async () => {
    const app = await buildApp();
    await app.inject({ method: "GET", url: "/v1/ai/protocols?protocol=a2a&enabled=false", headers: auth() });
    expect(H.listMock).toHaveBeenCalledWith(TENANT, 50, 0, { protocol: "a2a", enabled: false });
    await app.close();
  });

  it("400 — unknown protocol filter (zod)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/ai/protocols?protocol=soap", headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    expect((await app.inject({ method: "GET", url: "/v1/ai/protocols" })).statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/ai/protocols", headers: auth(USER, ["viewer"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("POST /v1/ai/protocols", () => {
  it("201 — registers an endpoint and normalises capabilities", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/ai/protocols", headers: auth(),
      payload: {
        protocol: "mcp", endpoint: "https://tools.example.gov.in/mcp",
        capabilities: [{ name: "search" }, { name: "search" }, { description: "no name" }],
      },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().data.capabilities).toEqual([{ name: "search", description: null, version: null }]);
    expect(H.insertMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("201 — emits protocolRegistered and writes an audit entry", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST", url: "/v1/ai/protocols", headers: auth(),
      payload: { protocol: "a2a", endpoint: "https://agents.example.gov.in/card" },
    });
    const topics = H.enqueueMock.mock.calls.map((c) => (c[1] as { topic: string }).topic);
    expect(topics).toContain("ai.protocol.registered");
    expect(H.auditInsertMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("422 — plain http to a remote host is refused", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/ai/protocols", headers: auth(),
      payload: { protocol: "mcp", endpoint: "http://tools.example.com/mcp" },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("ENDPOINT_INVALID");
    expect(H.insertMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("422 — a non-URL endpoint is refused", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/ai/protocols", headers: auth(),
      payload: { protocol: "mcp", endpoint: "tools.example.com" },
    });
    expect(r.statusCode).toBe(422);
    await app.close();
  });

  it("400 — unknown protocol (zod)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/ai/protocols", headers: auth(),
      payload: { protocol: "soap", endpoint: "https://x.example.com" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — endpoint missing (zod)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/ai/protocols", headers: auth(), payload: { protocol: "mcp" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/ai/protocols", payload: { protocol: "mcp", endpoint: "https://x.example.com" },
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — registering requires an admin role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/ai/protocols", headers: auth(USER, ["ai_user"]),
      payload: { protocol: "mcp", endpoint: "https://x.example.com" },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("PATCH /v1/ai/protocols/:id", () => {
  it("200 — disables a registration", async () => {
    H.findByIdMock.mockResolvedValue(makeRegistration({ version: 2 }));
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/ai/protocols/${REG_ID}`, headers: auth(),
      payload: { enabled: false, version: 2 },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toEqual({ id: REG_ID, updated: true, version: 3 });
    const topics = H.enqueueMock.mock.calls.map((c) => (c[1] as { topic: string }).topic);
    expect(topics).toContain("ai.protocol.updated");
    await app.close();
  });

  it("422 — a bad endpoint is refused on update too", async () => {
    H.findByIdMock.mockResolvedValue(makeRegistration());
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/ai/protocols/${REG_ID}`, headers: auth(),
      payload: { endpoint: "http://remote.example.com", version: 1 },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("ENDPOINT_INVALID");
    await app.close();
  });

  it("409 — version conflict", async () => {
    H.findByIdMock.mockResolvedValue(makeRegistration());
    H.updateMock.mockResolvedValue(false);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/ai/protocols/${REG_ID}`, headers: auth(), payload: { version: 1 },
    });
    expect(r.statusCode).toBe(409);
    await app.close();
  });

  it("404 — unknown registration", async () => {
    H.findByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/ai/protocols/${REG_ID}`, headers: auth(), payload: { version: 1 },
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("400 — version is required (zod)", async () => {
    H.findByIdMock.mockResolvedValue(makeRegistration());
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/ai/protocols/${REG_ID}`, headers: auth(), payload: { enabled: false },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/ai/protocols/${REG_ID}`, payload: { version: 1 },
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/ai/protocols/${REG_ID}`, headers: auth(USER, ["ai_user"]),
      payload: { version: 1 },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("GET /v1/ai/protocols/:id/capabilities", () => {
  it("200 — returns the discovered capability descriptor", async () => {
    H.findByIdMock.mockResolvedValue(makeRegistration());
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/ai/protocols/${REG_ID}/capabilities`, headers: auth(USER, ["ai_user"]),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toMatchObject({
      id: REG_ID, protocol: "mcp", transport: "jsonrpc", discovery: "tools/list",
      streaming: true, capabilityCount: 1,
    });
    await app.close();
  });

  it("404 — unknown registration", async () => {
    H.findByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/ai/protocols/${REG_ID}/capabilities`, headers: auth(),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("400 — id is not a uuid (zod)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/ai/protocols/nope/capabilities", headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/ai/protocols/${REG_ID}/capabilities` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/ai/protocols/${REG_ID}/capabilities`, headers: auth(USER, ["viewer"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
