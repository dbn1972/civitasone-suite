/**
 * Global search route tests — GET /api/v1/search
 *
 * Covers: happy path, permission filtering, graceful degradation,
 * query validation (min 2 chars, max 200), pagination.
 *
 * Validates: Requirements 19.2, 19.3, 19.4, 19.7
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { setSearchEngine, resolveUserModules } from "../src/search-route.js";
import type { SearchEngine, SearchQuery, SearchResponse, SearchDocument } from "@civitasone/search";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const ACTOR_ID = "00000000-0000-0000-0000-000000000099";

function makeToken(roles: string[], tid = TENANT_ID) {
  return signToken({ sub: ACTOR_ID, tid, roles, sid: "sess-1" }, SECRET, 3600);
}

// ── Mock Search Engine ────────────────────────────────────────────────────────

function createMockEngine(opts: {
  hits?: SearchResponse["hits"];
  totalHits?: number;
  shouldThrow?: boolean;
} = {}): SearchEngine {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    index: vi.fn().mockResolvedValue(undefined),
    bulkIndex: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockImplementation(async (query: SearchQuery): Promise<SearchResponse> => {
      if (opts.shouldThrow) {
        throw new Error("Connection refused");
      }
      return {
        hits: opts.hits ?? [],
        totalHits: opts.totalHits ?? (opts.hits?.length ?? 0),
        processingTimeMs: 5,
      };
    }),
    remove: vi.fn().mockResolvedValue(undefined),
    removeAll: vi.fn().mockResolvedValue(undefined),
    healthy: vi.fn().mockResolvedValue(!opts.shouldThrow),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

// Stub global fetch for the proxy handler (prevents real upstream calls)
beforeEach(() => {
  vi.stubGlobal("fetch", async () => {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setSearchEngine(null);
});

describe("GET /api/v1/search — happy path", () => {
  it("returns search results for authenticated user with correct shape", async () => {
    const mockEngine = createMockEngine({
      hits: [
        {
          id: "idx-1",
          documentId: "doc-1",
          title: "Budget Report Q4",
          content: '{"refNumber":"FIN-2024-001","description":"Q4 budget analysis","status":"active"}',
          tags: ["finance"],
          score: 0.95,
        },
        {
          id: "idx-2",
          documentId: "doc-2",
          title: "Employee Leave Application",
          content: '{"refNumber":"HR-2024-050","description":"Annual leave request","status":"pending"}',
          tags: ["hrms"],
          score: 0.82,
        },
      ],
      totalHits: 2,
    });
    setSearchEngine(mockEngine);

    const app = await buildApp();
    const token = makeToken(["super_admin"]);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/search?q=budget&page=1&pageSize=20",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data).toHaveLength(2);
    expect(body.meta).toEqual({ page: 1, pageSize: 20, total: 2 });

    // Verify result shape
    const first = body.data[0];
    expect(first).toHaveProperty("id", "doc-1");
    expect(first).toHaveProperty("module", "finance");
    expect(first).toHaveProperty("name", "Budget Report Q4");
    expect(first).toHaveProperty("refNumber", "FIN-2024-001");
    expect(first).toHaveProperty("description", "Q4 budget analysis");
    expect(first).toHaveProperty("status", "active");
    expect(first).toHaveProperty("snippet");
  });

  it("passes tenant ID from JWT to search engine", async () => {
    const mockEngine = createMockEngine({ hits: [], totalHits: 0 });
    setSearchEngine(mockEngine);

    const app = await buildApp();
    const token = makeToken(["super_admin"]);

    await app.inject({
      method: "GET",
      url: "/api/v1/search?q=test&page=1",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(mockEngine.search).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID }),
    );
  });
});

describe("GET /api/v1/search — permission filtering", () => {
  it("filters results by user module permissions (finance_officer sees only finance)", async () => {
    const mockEngine = createMockEngine({
      hits: [
        {
          id: "idx-1",
          documentId: "doc-1",
          title: "Bill Payment",
          content: '{"status":"approved"}',
          tags: ["finance"],
          score: 0.9,
        },
      ],
      totalHits: 1,
    });
    setSearchEngine(mockEngine);

    const app = await buildApp();
    const token = makeToken(["finance_officer"]);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/search?q=bill",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    // Verify search was called with the correct module tags
    expect(mockEngine.search).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ["finance"] }),
    );
  });

  it("excludes results from modules user cannot access", async () => {
    // A finance_officer gets a result tagged as "hrms" — it should be filtered out
    const mockEngine = createMockEngine({
      hits: [
        {
          id: "idx-1",
          documentId: "doc-1",
          title: "Salary Record",
          content: '{"status":"active"}',
          tags: ["hrms"],
          score: 0.85,
        },
      ],
      totalHits: 1,
    });
    setSearchEngine(mockEngine);

    const app = await buildApp();
    const token = makeToken(["finance_officer"]);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/search?q=salary",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    // hrms results should be filtered out since finance_officer only has finance access
    expect(body.data).toHaveLength(0);
  });

  it("super_admin sees results from all modules", async () => {
    const mockEngine = createMockEngine({
      hits: [
        { id: "idx-1", documentId: "doc-1", title: "Finance Bill", content: "{}", tags: ["finance"], score: 0.9 },
        { id: "idx-2", documentId: "doc-2", title: "HR Leave", content: "{}", tags: ["hrms"], score: 0.8 },
        { id: "idx-3", documentId: "doc-3", title: "Legal Case", content: "{}", tags: ["legal"], score: 0.7 },
      ],
      totalHits: 3,
    });
    setSearchEngine(mockEngine);

    const app = await buildApp();
    const token = makeToken(["super_admin"]);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/search?q=test",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data).toHaveLength(3);
  });

  it("returns empty results when user has no module permissions", async () => {
    const mockEngine = createMockEngine({ hits: [], totalHits: 0 });
    setSearchEngine(mockEngine);

    const app = await buildApp();
    // Token with no recognized roles
    const token = makeToken(["unknown_role"]);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/search?q=test",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data).toHaveLength(0);
    expect(body.meta.total).toBe(0);
  });
});

describe("GET /api/v1/search — graceful degradation", () => {
  it("returns 503 SEARCH_UNAVAILABLE when search engine is unreachable", async () => {
    const mockEngine = createMockEngine({ shouldThrow: true });
    setSearchEngine(mockEngine);

    const app = await buildApp();
    const token = makeToken(["super_admin"]);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/search?q=test",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(503);
    const body = JSON.parse(res.payload);
    expect(body.error.code).toBe("SEARCH_UNAVAILABLE");
    expect(body.error.message).toContain("temporarily unavailable");
  });
});

describe("GET /api/v1/search — query validation", () => {
  it("returns 400 when query is less than 2 characters", async () => {
    const mockEngine = createMockEngine();
    setSearchEngine(mockEngine);

    const app = await buildApp();
    const token = makeToken(["super_admin"]);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/search?q=a",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.message).toContain("at least 2 characters");
  });

  it("returns 400 when query is empty", async () => {
    const mockEngine = createMockEngine();
    setSearchEngine(mockEngine);

    const app = await buildApp();
    const token = makeToken(["super_admin"]);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/search?q=",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("returns 400 when query exceeds 200 characters", async () => {
    const mockEngine = createMockEngine();
    setSearchEngine(mockEngine);

    const app = await buildApp();
    const token = makeToken(["super_admin"]);
    const longQuery = "x".repeat(201);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/search?q=${longQuery}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.message).toContain("200 characters");
  });

  it("accepts a query with exactly 2 characters", async () => {
    const mockEngine = createMockEngine({ hits: [], totalHits: 0 });
    setSearchEngine(mockEngine);

    const app = await buildApp();
    const token = makeToken(["super_admin"]);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/search?q=ab",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
  });

  it("accepts a query with exactly 200 characters", async () => {
    const mockEngine = createMockEngine({ hits: [], totalHits: 0 });
    setSearchEngine(mockEngine);

    const app = await buildApp();
    const token = makeToken(["super_admin"]);
    const query200 = "x".repeat(200);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/search?q=${query200}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
  });
});

describe("GET /api/v1/search — authentication", () => {
  it("returns 401 when no authorization header is present", async () => {
    const mockEngine = createMockEngine();
    setSearchEngine(mockEngine);

    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/search?q=test",
    });

    expect(res.statusCode).toBe(401);
  });

  it("returns 401 when authorization header is invalid", async () => {
    const mockEngine = createMockEngine();
    setSearchEngine(mockEngine);

    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/search?q=test",
      headers: { authorization: "Basic invalid" },
    });

    expect(res.statusCode).toBe(401);
  });
});

describe("GET /api/v1/search — pagination", () => {
  it("defaults to page 1 and pageSize 20", async () => {
    const mockEngine = createMockEngine({ hits: [], totalHits: 0 });
    setSearchEngine(mockEngine);

    const app = await buildApp();
    const token = makeToken(["super_admin"]);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/search?q=test",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.meta.page).toBe(1);
    expect(body.meta.pageSize).toBe(20);

    // Verify engine was called with correct offset/limit
    expect(mockEngine.search).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 20, offset: 0 }),
    );
  });

  it("respects custom page and pageSize params", async () => {
    const mockEngine = createMockEngine({ hits: [], totalHits: 50 });
    setSearchEngine(mockEngine);

    const app = await buildApp();
    const token = makeToken(["super_admin"]);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/search?q=test&page=3&pageSize=10",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.meta.page).toBe(3);
    expect(body.meta.pageSize).toBe(10);

    // Page 3 with pageSize 10 → offset 20
    expect(mockEngine.search).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, offset: 20 }),
    );
  });

  it("caps pageSize at 20 even if larger value requested", async () => {
    const mockEngine = createMockEngine({ hits: [], totalHits: 0 });
    setSearchEngine(mockEngine);

    const app = await buildApp();
    const token = makeToken(["super_admin"]);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/search?q=test&pageSize=100",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.meta.pageSize).toBe(20);

    expect(mockEngine.search).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 20 }),
    );
  });
});

describe("resolveUserModules", () => {
  it("returns all modules for super_admin", () => {
    const modules = resolveUserModules(["super_admin"]);
    expect(modules.length).toBeGreaterThan(10);
    expect(modules).toContain("finance");
    expect(modules).toContain("hrms");
    expect(modules).toContain("legal");
  });

  it("returns all modules for tenant_admin", () => {
    const modules = resolveUserModules(["tenant_admin"]);
    expect(modules.length).toBeGreaterThan(10);
  });

  it("returns finance for finance_officer", () => {
    const modules = resolveUserModules(["finance_officer"]);
    expect(modules).toEqual(["finance"]);
  });

  it("returns hrms and payroll for hr_admin", () => {
    const modules = resolveUserModules(["hr_admin"]);
    expect(modules).toContain("hrms");
    expect(modules).toContain("payroll");
    expect(modules).toHaveLength(2);
  });

  it("unions permissions from multiple roles", () => {
    const modules = resolveUserModules(["finance_officer", "hr_officer"]);
    expect(modules).toContain("finance");
    expect(modules).toContain("hrms");
    expect(modules).toContain("payroll");
    expect(modules).toHaveLength(3);
  });

  it("returns empty array for unknown roles", () => {
    const modules = resolveUserModules(["nonexistent_role"]);
    expect(modules).toEqual([]);
  });
});
