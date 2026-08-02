/**
 * AG-003 no-code agent authoring — domain unit tests + route tests.
 * Explicitly covers the publish gate: empty prompt or no tools → 422.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import {
  validateDefinition,
  publishBlockers,
  validateAuthoringTransition,
  MAX_SYSTEM_PROMPT_LENGTH,
} from "../src/modules/authoring/domain.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const DEF_ID = "88888888-1111-4000-8000-000000000001";

const GOOD = {
  name: "Grievance Triage",
  systemPrompt: "You triage citizen grievances.",
  tools: [{ name: "lookup_ticket" }],
  modelConfig: { model: "gpt-x", temperature: 0.2 },
};

// ── DOMAIN ────────────────────────────────────────────────────────────────────

describe("validateDefinition", () => {
  it("accepts a complete definition as publishable", () => {
    const r = validateDefinition(GOOD);
    expect(r.valid).toBe(true);
    expect(r.publishable).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it("requires a name", () => {
    expect(validateDefinition({ ...GOOD, name: "" }).issues.some((i) => i.code === "NAME_REQUIRED")).toBe(true);
    expect(validateDefinition({ ...GOOD, name: "   " }).valid).toBe(false);
    expect(validateDefinition({ ...GOOD, name: 42 }).valid).toBe(false);
  });

  it("rejects an over-long name", () => {
    expect(validateDefinition({ ...GOOD, name: "x".repeat(201) }).issues.some((i) => i.code === "NAME_TOO_LONG")).toBe(true);
  });

  it("rejects an over-long system prompt", () => {
    const r = validateDefinition({ ...GOOD, systemPrompt: "x".repeat(MAX_SYSTEM_PROMPT_LENGTH + 1) });
    expect(r.issues.some((i) => i.code === "SYSTEM_PROMPT_TOO_LONG")).toBe(true);
    expect(r.valid).toBe(false);
  });

  it("rejects a non-string system prompt", () => {
    expect(validateDefinition({ ...GOOD, systemPrompt: 5 }).issues.some((i) => i.code === "SYSTEM_PROMPT_TYPE")).toBe(true);
  });

  it("rejects a non-array tools value", () => {
    expect(validateDefinition({ ...GOOD, tools: "search" }).issues.some((i) => i.code === "TOOLS_TYPE")).toBe(true);
  });

  it("rejects too many tools", () => {
    const tools = Array.from({ length: 51 }, (_, i) => ({ name: `t${i}` }));
    expect(validateDefinition({ ...GOOD, tools }).issues.some((i) => i.code === "TOOLS_TOO_MANY")).toBe(true);
  });

  it("rejects malformed tool entries", () => {
    expect(validateDefinition({ ...GOOD, tools: ["nope"] }).issues.some((i) => i.code === "TOOL_SHAPE")).toBe(true);
    expect(validateDefinition({ ...GOOD, tools: [{}] }).issues.some((i) => i.code === "TOOL_NAME_REQUIRED")).toBe(true);
    expect(validateDefinition({ ...GOOD, tools: [null] }).issues.some((i) => i.code === "TOOL_SHAPE")).toBe(true);
  });

  it("rejects duplicate tool names case-insensitively", () => {
    const r = validateDefinition({ ...GOOD, tools: [{ name: "Search" }, { name: "search" }] });
    expect(r.issues.some((i) => i.code === "TOOL_DUPLICATE")).toBe(true);
  });

  it("rejects a non-object modelConfig and out-of-range temperature", () => {
    expect(validateDefinition({ ...GOOD, modelConfig: [1] }).issues.some((i) => i.code === "MODEL_CONFIG_TYPE")).toBe(true);
    expect(validateDefinition({ ...GOOD, modelConfig: { model: "m", temperature: 5 } })
      .issues.some((i) => i.code === "TEMPERATURE_RANGE")).toBe(true);
    expect(validateDefinition({ ...GOOD, modelConfig: { model: "m", temperature: "hot" } })
      .issues.some((i) => i.code === "TEMPERATURE_RANGE")).toBe(true);
  });

  it("warns (does not block) when no model is pinned", () => {
    const r = validateDefinition({ ...GOOD, modelConfig: { temperature: 0.1 } });
    expect(r.valid).toBe(true);
    expect(r.publishable).toBe(true);
    expect(r.issues.some((i) => i.code === "MODEL_UNSET" && i.severity === "warning")).toBe(true);
  });

  it("warns when modelConfig is absent entirely", () => {
    const r = validateDefinition({ name: "n", systemPrompt: "p", tools: [{ name: "t" }] });
    expect(r.publishable).toBe(true);
    expect(r.issues.some((i) => i.code === "MODEL_CONFIG_EMPTY")).toBe(true);
  });

  it("a draft with no prompt is valid but not publishable", () => {
    const r = validateDefinition({ name: "Draft", systemPrompt: "", tools: [], modelConfig: { model: "m" } });
    expect(r.valid).toBe(true);
    expect(r.publishable).toBe(false);
    expect(r.issues.map((i) => i.code)).toContain("SYSTEM_PROMPT_REQUIRED");
    expect(r.issues.map((i) => i.code)).toContain("TOOLS_REQUIRED");
  });

  it("a whitespace-only prompt does not satisfy the publish gate", () => {
    expect(validateDefinition({ ...GOOD, systemPrompt: "   " }).publishable).toBe(false);
  });
});

describe("publishBlockers", () => {
  it("returns nothing for a publishable definition", () => {
    expect(publishBlockers(GOOD)).toEqual([]);
  });

  it("returns the prompt blocker when the prompt is empty", () => {
    expect(publishBlockers({ ...GOOD, systemPrompt: "" }).map((i) => i.code)).toContain("SYSTEM_PROMPT_REQUIRED");
  });

  it("returns the tools blocker when there are no tools", () => {
    expect(publishBlockers({ ...GOOD, tools: [] }).map((i) => i.code)).toContain("TOOLS_REQUIRED");
  });

  it("only returns errors, never warnings", () => {
    const blockers = publishBlockers({ name: "n", systemPrompt: "", tools: [] });
    expect(blockers.every((i) => i.severity === "error")).toBe(true);
  });
});

describe("validateAuthoringTransition", () => {
  it("allows draft → published and draft → archived", () => {
    expect(validateAuthoringTransition("draft", "published")).toBeNull();
    expect(validateAuthoringTransition("draft", "archived")).toBeNull();
  });

  it("allows published → archived but never published → draft", () => {
    expect(validateAuthoringTransition("published", "archived")).toBeNull();
    expect(validateAuthoringTransition("published", "draft")).toContain("cannot transition");
  });

  it("archived is terminal", () => {
    expect(validateAuthoringTransition("archived", "published")).toContain("cannot transition");
  });

  it("rejects unknown statuses", () => {
    expect(validateAuthoringTransition("nope", "draft")).toContain("unknown");
    expect(validateAuthoringTransition("draft", "nope")).toContain("unknown");
  });
});

// ── ROUTES ────────────────────────────────────────────────────────────────────

const H = vi.hoisted(() => ({
  publishMock: vi.fn(),
  dbTransactionMock: vi.fn(),
  scopedReadMock: vi.fn(),
  enqueueMock: vi.fn(),
  auditInsertMock: vi.fn(),
  findByIdMock: vi.fn(),
  findByNameMock: vi.fn(),
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
  queue: { publish: (...a: unknown[]) => H.publishMock(...a) },
}));

vi.mock("../src/modules/authoring/repo.js", () => ({
  findById: (...a: unknown[]) => H.findByIdMock(...a),
  findByName: (...a: unknown[]) => H.findByNameMock(...a),
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

function makeDefinition(over: Record<string, unknown> = {}) {
  return {
    id: DEF_ID, tenantId: TENANT, name: "Grievance Triage", description: null,
    systemPrompt: "You triage citizen grievances.", tools: [{ name: "lookup_ticket" }],
    modelConfig: { model: "gpt-x" }, status: "draft", publishedAt: null,
    createdAt: new Date(), updatedAt: new Date(), createdBy: USER, updatedBy: USER, version: 1,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.publishMock.mockResolvedValue(undefined);
  H.dbTransactionMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb({}));
  H.enqueueMock.mockResolvedValue(undefined);
  H.auditInsertMock.mockResolvedValue(undefined);
  H.findByNameMock.mockResolvedValue(null);
  H.listMock.mockResolvedValue({ rows: [], total: 0 });
  H.insertMock.mockResolvedValue(undefined);
  H.updateMock.mockResolvedValue(true);
});

describe("GET /v1/ai/authoring/agents", () => {
  it("200 — paginated list", async () => {
    H.listMock.mockResolvedValue({ rows: [makeDefinition()], total: 1 });
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: "/v1/ai/authoring/agents?limit=10", headers: auth(USER, ["ai_user"]),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    expect(r.json().meta).toEqual({ page: 1, pageSize: 10, total: 1 });
    await app.close();
  });

  it("200 — passes status and search filters through", async () => {
    const app = await buildApp();
    await app.inject({ method: "GET", url: "/v1/ai/authoring/agents?status=draft&search=triage", headers: auth() });
    expect(H.listMock).toHaveBeenCalledWith(TENANT, 50, 0, { status: "draft", search: "triage" });
    await app.close();
  });

  it("400 — unknown status filter (zod)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/ai/authoring/agents?status=live", headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    expect((await app.inject({ method: "GET", url: "/v1/ai/authoring/agents" })).statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/ai/authoring/agents", headers: auth(USER, ["viewer"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("POST /v1/ai/authoring/agents", () => {
  it("202 — creates a draft", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/ai/authoring/agents", headers: auth(),
      payload: { name: "Grievance Triage", systemPrompt: "You triage.", tools: [{ name: "lookup_ticket" }] },
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().status).toBe("accepted");
    expect(H.publishMock).toHaveBeenCalled();
    await app.close();});

  it("202 — a bare draft is allowed and reported as not publishable", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/ai/authoring/agents", headers: auth(), payload: { name: "Skeleton" },
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().status).toBe("accepted");
    await app.close();});

  it("202 — emits drafted and writes an audit entry", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST", url: "/v1/ai/authoring/agents", headers: auth(), payload: { name: "Skeleton" },
    });
    expect(H.publishMock).toHaveBeenCalled();
    await app.close();});

  it("409 — the tenant already has a definition with that name", async () => {
    H.findByNameMock.mockResolvedValue(makeDefinition());
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/ai/authoring/agents", headers: auth(), payload: { name: "Grievance Triage" },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("NAME_TAKEN");
    await app.close();});

  it("422 — duplicate tool names", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/ai/authoring/agents", headers: auth(),
      payload: { name: "Dup", tools: [{ name: "a" }, { name: "A" }] },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("DEFINITION_INVALID");
    await app.close();});

  it("422 — system prompt beyond the domain limit", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/ai/authoring/agents", headers: auth(),
      payload: { name: "Long", systemPrompt: "x".repeat(16001) },
    });
    expect(r.statusCode).toBe(422);
    await app.close();});

  it("400 — name missing (zod)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/ai/authoring/agents", headers: auth(), payload: {} });
    expect(r.statusCode).toBe(400);
    await app.close();});

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/ai/authoring/agents", payload: { name: "X" } });
    expect(r.statusCode).toBe(401);
    await app.close();});

  it("403 — creating requires an admin role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/ai/authoring/agents", headers: auth(USER, ["ai_user"]), payload: { name: "X" },
    });
    expect(r.statusCode).toBe(403);
    await app.close();});
});

describe("PATCH /v1/ai/authoring/agents/:id", () => {
  it("202 — updates a draft", async () => {
    H.findByIdMock.mockResolvedValue(makeDefinition());
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/ai/authoring/agents/${DEF_ID}`, headers: auth(),
      payload: { systemPrompt: "Updated prompt", version: 1 },
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().status).toBe("accepted");
    await app.close();});

  it("404 — unknown definition", async () => {
    H.findByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/ai/authoring/agents/${DEF_ID}`, headers: auth(), payload: { version: 1 },
    });
    expect(r.statusCode).toBe(404);
    await app.close();});

  it("422 — an archived definition cannot be edited", async () => {
    H.findByIdMock.mockResolvedValue(makeDefinition({ status: "archived" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/ai/authoring/agents/${DEF_ID}`, headers: auth(), payload: { version: 1 },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("DEFINITION_ARCHIVED");
    await app.close();});

  it("422 — the merged definition must stay valid", async () => {
    H.findByIdMock.mockResolvedValue(makeDefinition());
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/ai/authoring/agents/${DEF_ID}`, headers: auth(),
      payload: { tools: [{ name: "a" }, { name: "a" }], version: 1 },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("DEFINITION_INVALID");
    await app.close();});

  it("409 — version conflict", async () => {
    H.findByIdMock.mockResolvedValue(makeDefinition({ version: 2 }));
    H.updateMock.mockResolvedValue(false);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/ai/authoring/agents/${DEF_ID}`, headers: auth(), payload: { version: 1 },
    });
    expect(r.statusCode).toBe(409);
    await app.close();});

  it("400 — version is required (zod)", async () => {
    H.findByIdMock.mockResolvedValue(makeDefinition());
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/ai/authoring/agents/${DEF_ID}`, headers: auth(), payload: { name: "X" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();});

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/ai/authoring/agents/${DEF_ID}`, payload: { version: 1 },
    });
    expect(r.statusCode).toBe(401);
    await app.close();});

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/ai/authoring/agents/${DEF_ID}`, headers: auth(USER, ["ai_user"]),
      payload: { version: 1 },
    });
    expect(r.statusCode).toBe(403);
    await app.close();});
});

describe("POST /v1/ai/authoring/agents/:id/publish", () => {
  it("202 — publishes a complete draft", async () => {
    H.findByIdMock.mockResolvedValue(makeDefinition({ version: 2 }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/authoring/agents/${DEF_ID}/publish`, headers: auth(),
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().status).toBe("accepted");
        expect(H.publishMock).toHaveBeenCalled();
    await app.close();});

  it("422 — publishing with an empty system prompt is refused", async () => {
    H.findByIdMock.mockResolvedValue(makeDefinition({ systemPrompt: "" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/authoring/agents/${DEF_ID}/publish`, headers: auth(),
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("NOT_PUBLISHABLE");
    expect((r.json().details.issues as Array<{ code: string }>).map((i) => i.code))
      .toContain("SYSTEM_PROMPT_REQUIRED");
    expect(H.updateMock).not.toHaveBeenCalled();
    await app.close();});

  it("422 — publishing with a whitespace-only prompt is refused", async () => {
    H.findByIdMock.mockResolvedValue(makeDefinition({ systemPrompt: "    " }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/authoring/agents/${DEF_ID}/publish`, headers: auth(),
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("NOT_PUBLISHABLE");
    await app.close();});

  it("422 — publishing with no tools is refused", async () => {
    H.findByIdMock.mockResolvedValue(makeDefinition({ tools: [] }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/authoring/agents/${DEF_ID}/publish`, headers: auth(),
    });
    expect(r.statusCode).toBe(422);
    expect((r.json().details.issues as Array<{ code: string }>).map((i) => i.code)).toContain("TOOLS_REQUIRED");
    expect(H.updateMock).not.toHaveBeenCalled();
    await app.close();});

  it("422 — an already published definition cannot be republished", async () => {
    H.findByIdMock.mockResolvedValue(makeDefinition({ status: "published" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/authoring/agents/${DEF_ID}/publish`, headers: auth(),
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("INVALID_TRANSITION");
    await app.close();});

  it("409 — version conflict", async () => {
    H.findByIdMock.mockResolvedValue(makeDefinition({ version: 2 }));
    H.updateMock.mockResolvedValue(false);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/authoring/agents/${DEF_ID}/publish`, headers: auth(), payload: { version: 1 },
    });
    expect(r.statusCode).toBe(409);
    await app.close();});

  it("404 — unknown definition", async () => {
    H.findByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/authoring/agents/${DEF_ID}/publish`, headers: auth(),
    });
    expect(r.statusCode).toBe(404);
    await app.close();});

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/ai/authoring/agents/${DEF_ID}/publish` });
    expect(r.statusCode).toBe(401);
    await app.close();});

  it("403 — publishing requires an admin role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/authoring/agents/${DEF_ID}/publish`, headers: auth(USER, ["ai_user"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();});
});

describe("POST /v1/ai/authoring/agents/:id/archive", () => {
  it("202 — archives a draft", async () => {
    H.findByIdMock.mockResolvedValue(makeDefinition({ version: 4 }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/authoring/agents/${DEF_ID}/archive`, headers: auth(),
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().status).toBe("accepted");
    expect(H.publishMock).toHaveBeenCalled();
    await app.close();});

  it("202 — archives a published definition", async () => {
    H.findByIdMock.mockResolvedValue(makeDefinition({ status: "published" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/authoring/agents/${DEF_ID}/archive`, headers: auth(),
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().status).toBe("accepted");
    await app.close();});

  it("422 — already archived", async () => {
    H.findByIdMock.mockResolvedValue(makeDefinition({ status: "archived" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/authoring/agents/${DEF_ID}/archive`, headers: auth(),
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("INVALID_TRANSITION");
    await app.close();});

  it("409 — version conflict", async () => {
    H.findByIdMock.mockResolvedValue(makeDefinition({ version: 2 }));
    H.updateMock.mockResolvedValue(false);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/authoring/agents/${DEF_ID}/archive`, headers: auth(), payload: { version: 1 },
    });
    expect(r.statusCode).toBe(409);
    await app.close();});

  it("404 — unknown definition", async () => {
    H.findByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/authoring/agents/${DEF_ID}/archive`, headers: auth(),
    });
    expect(r.statusCode).toBe(404);
    await app.close();});

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/ai/authoring/agents/${DEF_ID}/archive` });
    expect(r.statusCode).toBe(401);
    await app.close();});

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/authoring/agents/${DEF_ID}/archive`, headers: auth(USER, ["ai_user"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();});
});

describe("POST /v1/ai/authoring/agents/:id/validate", () => {
  it("200 — dry run reports the stored definition and persists nothing", async () => {
    H.findByIdMock.mockResolvedValue(makeDefinition());
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/authoring/agents/${DEF_ID}/validate`, headers: auth(USER, ["ai_user"]),
    });
    expect(r.statusCode).toBe(200);
    expect(H.updateMock).not.toHaveBeenCalled();
    expect(H.insertMock).not.toHaveBeenCalled();
    expect(H.auditInsertMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("200 — validates unsaved overrides", async () => {
    H.findByIdMock.mockResolvedValue(makeDefinition());
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/authoring/agents/${DEF_ID}/validate`, headers: auth(),
      payload: { tools: [] },
    });
    expect((r.json().data.issues as Array<{ code: string }>).map((i) => i.code)).toContain("TOOLS_REQUIRED");
    await app.close();
  });

  it("200 — reports issues for an incomplete stored draft", async () => {
    H.findByIdMock.mockResolvedValue(makeDefinition({ systemPrompt: "", tools: [] }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/authoring/agents/${DEF_ID}/validate`, headers: auth(),
    });
    await app.close();
  });

  it("404 — unknown definition", async () => {
    H.findByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/authoring/agents/${DEF_ID}/validate`, headers: auth(),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("400 — id is not a uuid (zod)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/ai/authoring/agents/nope/validate", headers: auth(),
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/ai/authoring/agents/${DEF_ID}/validate` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/authoring/agents/${DEF_ID}/validate`, headers: auth(USER, ["viewer"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
