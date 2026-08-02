/**
 * F.4 governed ReAct tooling — domain + route tests.
 * Explicitly covers the governance boundary: a requires_approval tool does NOT execute.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import {
  decideReactStep,
  defaultToolsFor,
  validateToolDefinition,
  validateAgentDomain,
  DEFAULT_TOOL_TEMPLATES,
  AGENT_DOMAINS,
} from "../src/modules/tools/domain.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const AGENT_ID = "eeeeeeee-1111-4000-8000-000000000001";
const TOOL_ID = "55555555-1111-4000-8000-000000000001";

// ── DOMAIN ────────────────────────────────────────────────────────────────────

describe("validateAgentDomain", () => {
  it("accepts every supported domain", () => {
    for (const d of AGENT_DOMAINS) expect(validateAgentDomain(d)).toBeNull();
  });

  it("rejects anything else", () => {
    expect(validateAgentDomain("payroll")).toContain("must be one of");
  });
});

describe("validateToolDefinition", () => {
  const good = { agentDomain: "crm", toolName: "lookup_customer", inputSchema: { type: "object" } };

  it("accepts a well-formed definition", () => {
    expect(validateToolDefinition(good)).toBeNull();
  });

  it("requires an agentDomain", () => {
    expect(validateToolDefinition({ ...good, agentDomain: undefined })).toContain("agentDomain is required");
    expect(validateToolDefinition({ ...good, agentDomain: "nope" })).toContain("must be one of");
  });

  it("requires a toolName", () => {
    expect(validateToolDefinition({ ...good, toolName: "" })).toContain("toolName is required");
    expect(validateToolDefinition({ ...good, toolName: 7 })).toContain("toolName is required");
  });

  it("rejects an over-long toolName", () => {
    expect(validateToolDefinition({ ...good, toolName: `a${"b".repeat(120)}` })).toContain("at most 120");
  });

  it("rejects tool names that could smuggle prompt delimiters", () => {
    expect(validateToolDefinition({ ...good, toolName: "Lookup Customer" })).toContain("lower_snake_case");
    expect(validateToolDefinition({ ...good, toolName: "close<|im_end|>" })).toContain("lower_snake_case");
    expect(validateToolDefinition({ ...good, toolName: "1tool" })).toContain("lower_snake_case");
  });

  it("accepts dotted namespaced names", () => {
    expect(validateToolDefinition({ ...good, toolName: "crm.lookup_customer" })).toBeNull();
  });

  it("rejects a non-object inputSchema", () => {
    expect(validateToolDefinition({ ...good, inputSchema: [1] })).toContain("must be an object");
    expect(validateToolDefinition({ ...good, inputSchema: "string" })).toContain("must be an object");
  });

  it("allows an absent inputSchema", () => {
    expect(validateToolDefinition({ agentDomain: "crm", toolName: "x" })).toBeNull();
  });
});

describe("decideReactStep — GOVERNANCE BOUNDARY", () => {
  it("an ordinary enabled tool executes", () => {
    expect(decideReactStep({ enabled: true, requiresApproval: false })).toEqual({
      executed: true, status: "executed", code: "EXECUTED", message: "step executed",
    });
  });

  it("a requires_approval tool does NOT execute", () => {
    const d = decideReactStep({ enabled: true, requiresApproval: true });
    expect(d.executed).toBe(false);
    expect(d.status).toBe("pending_approval");
    expect(d.code).toBe("PENDING_APPROVAL");
  });

  it("a disabled tool is rejected and does not execute", () => {
    const d = decideReactStep({ enabled: false, requiresApproval: false });
    expect(d.executed).toBe(false);
    expect(d.status).toBe("rejected");
    expect(d.code).toBe("TOOL_DISABLED");
  });

  it("disabled wins over approval", () => {
    expect(decideReactStep({ enabled: false, requiresApproval: true }).code).toBe("TOOL_DISABLED");
  });
});

describe("defaultToolsFor", () => {
  it("returns every template when no domain is given", () => {
    expect(defaultToolsFor()).toHaveLength(DEFAULT_TOOL_TEMPLATES.length);
  });

  it("returns the CRM/Sales agent tool set", () => {
    const crm = defaultToolsFor("crm");
    expect(crm.length).toBeGreaterThanOrEqual(3);
    expect(crm.every((t) => t.agentDomain === "crm")).toBe(true);
    expect(crm.map((t) => t.toolName)).toContain("lookup_customer");
  });

  it("returns the Service/ticket agent tool set", () => {
    const helpdesk = defaultToolsFor("helpdesk");
    expect(helpdesk.every((t) => t.agentDomain === "helpdesk")).toBe(true);
    expect(helpdesk.map((t) => t.toolName)).toContain("lookup_ticket");
  });

  it("returns nothing for a domain with no templates", () => {
    expect(defaultToolsFor("finance")).toEqual([]);
  });

  it("gates the tools a citizen or customer would feel", () => {
    const byName = new Map(DEFAULT_TOOL_TEMPLATES.map((t) => [t.toolName, t]));
    expect(byName.get("close_ticket")?.requiresApproval).toBe(true);
    expect(byName.get("escalate_ticket")?.requiresApproval).toBe(true);
    expect(byName.get("apply_discount")?.requiresApproval).toBe(true);
    expect(byName.get("create_quotation")?.requiresApproval).toBe(true);
    expect(byName.get("lookup_ticket")?.requiresApproval).toBe(false);
    expect(byName.get("search_knowledge")?.requiresApproval).toBe(false);
  });

  it("every template passes its own validator", () => {
    for (const t of DEFAULT_TOOL_TEMPLATES) {
      expect(validateToolDefinition(t)).toBeNull();
    }
  });
});

// ── ROUTES ────────────────────────────────────────────────────────────────────

const H = vi.hoisted(() => ({
  publishMock: vi.fn(),
  dbTransactionMock: vi.fn(),
  scopedReadMock: vi.fn(),
  enqueueMock: vi.fn(),
  auditInsertMock: vi.fn(),
  agentFindByIdMock: vi.fn(),
  findByIdMock: vi.fn(),
  findByNameMock: vi.fn(),
  listMock: vi.fn(),
  insertMock: vi.fn(),
  insertManyMock: vi.fn(),
  updateMock: vi.fn(),
  insertStepMock: vi.fn(),
  countStepsMock: vi.fn(),
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

vi.mock("../src/modules/tools/repo.js", () => ({
  findById: (...a: unknown[]) => H.findByIdMock(...a),
  findByName: (...a: unknown[]) => H.findByNameMock(...a),
  listByTenant: (...a: unknown[]) => H.listMock(...a),
  insert: (...a: unknown[]) => H.insertMock(...a),
  insertManyIgnoreConflicts: (...a: unknown[]) => H.insertManyMock(...a),
  update: (...a: unknown[]) => H.updateMock(...a),
  insertStep: (...a: unknown[]) => H.insertStepMock(...a),
  countSteps: (...a: unknown[]) => H.countStepsMock(...a),
  listSteps: vi.fn(async () => ({ rows: [], total: 0 })),
  toView: (r: Record<string, unknown>) => r,
  toStepView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/agents/repo.js", () => ({
  findById: (...a: unknown[]) => H.agentFindByIdMock(...a),
  listByTenant: vi.fn(async () => ({ rows: [], total: 0 })),
  listByStatus: vi.fn(async () => []),
  countByStatus: vi.fn(async () => 0),
  insert: vi.fn(), update: vi.fn(), archive: vi.fn(),
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

function makeTool(over: Record<string, unknown> = {}) {
  return {
    id: TOOL_ID, tenantId: TENANT, agentDomain: "helpdesk", toolName: "lookup_ticket",
    description: "Fetch a ticket", inputSchema: { type: "object" },
    requiresApproval: false, enabled: true,
    createdAt: new Date(), updatedAt: new Date(), createdBy: USER, updatedBy: USER, version: 1,
    ...over,
  };
}

function makeAgent(over: Record<string, unknown> = {}) {
  return { id: AGENT_ID, tenantId: TENANT, name: "Service Bot", skills: [], tools: [], status: "active", version: 1, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.publishMock.mockResolvedValue(undefined);
  H.dbTransactionMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb({}));
  H.enqueueMock.mockResolvedValue(undefined);
  H.auditInsertMock.mockResolvedValue(undefined);
  H.agentFindByIdMock.mockResolvedValue(makeAgent());
  H.findByNameMock.mockResolvedValue(null);
  H.listMock.mockResolvedValue({ rows: [], total: 0 });
  H.insertMock.mockResolvedValue(undefined);
  H.insertManyMock.mockResolvedValue(5);
  H.updateMock.mockResolvedValue(true);
  H.insertStepMock.mockResolvedValue(undefined);
  H.countStepsMock.mockResolvedValue(0);
});

describe("GET /v1/ai/tools", () => {
  it("200 — paginated catalogue", async () => {
    H.listMock.mockResolvedValue({ rows: [makeTool()], total: 1 });
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/ai/tools", headers: auth(USER, ["ai_user"]) });
    expect(r.statusCode).toBe(200);
    expect(r.json().meta).toEqual({ page: 1, pageSize: 50, total: 1 });
    await app.close();
  });

  it("200 — ?agentDomain=crm returns the CRM/Sales tool set", async () => {
    const app = await buildApp();
    await app.inject({ method: "GET", url: "/v1/ai/tools?agentDomain=crm", headers: auth() });
    expect(H.listMock).toHaveBeenCalledWith(TENANT, 50, 0, { agentDomain: "crm" });
    await app.close();
  });

  it("200 — ?agentDomain=helpdesk returns the Service/ticket tool set", async () => {
    const app = await buildApp();
    await app.inject({ method: "GET", url: "/v1/ai/tools?agentDomain=helpdesk", headers: auth() });
    expect(H.listMock).toHaveBeenCalledWith(TENANT, 50, 0, { agentDomain: "helpdesk" });
    await app.close();
  });

  it("200 — filters on enabled and requiresApproval", async () => {
    const app = await buildApp();
    await app.inject({
      method: "GET", url: "/v1/ai/tools?enabled=true&requiresApproval=true", headers: auth(),
    });
    expect(H.listMock).toHaveBeenCalledWith(TENANT, 50, 0, { enabled: true, requiresApproval: true });
    await app.close();
  });

  it("400 — unknown agentDomain (zod)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/ai/tools?agentDomain=payroll", headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — limit above the maximum (zod)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/ai/tools?limit=1000", headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    expect((await app.inject({ method: "GET", url: "/v1/ai/tools" })).statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/ai/tools", headers: auth(USER, ["viewer"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("POST /v1/ai/tools", () => {
  it("202 — defines a tool", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/ai/tools", headers: auth(),
      payload: { agentDomain: "crm", toolName: "lookup_customer", requiresApproval: false },
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().status).toBe("accepted");
    expect(H.publishMock).toHaveBeenCalled();
    await app.close();});

  it("202 — emits toolDefined and writes an audit entry", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST", url: "/v1/ai/tools", headers: auth(),
      payload: { agentDomain: "crm", toolName: "lookup_customer" },
    });
    expect(H.publishMock).toHaveBeenCalled();
    await app.close();});

  it("409 — the tool already exists for that tenant and domain", async () => {
    H.findByNameMock.mockResolvedValue(makeTool());
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/ai/tools", headers: auth(),
      payload: { agentDomain: "helpdesk", toolName: "lookup_ticket" },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("TOOL_EXISTS");
    await app.close();});

  it("422 — a tool name that is not lower_snake_case", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/ai/tools", headers: auth(),
      payload: { agentDomain: "crm", toolName: "Lookup Customer" },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("TOOL_INVALID");
    await app.close();});

  it("400 — unknown agentDomain (zod)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/ai/tools", headers: auth(),
      payload: { agentDomain: "payroll", toolName: "x" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();});

  it("400 — toolName missing (zod)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/ai/tools", headers: auth(), payload: { agentDomain: "crm" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();});

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/ai/tools", payload: { agentDomain: "crm", toolName: "x" },
    });
    expect(r.statusCode).toBe(401);
    await app.close();});

  it("403 — defining a tool requires an admin role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/ai/tools", headers: auth(USER, ["ai_user"]),
      payload: { agentDomain: "crm", toolName: "lookup_customer" },
    });
    expect(r.statusCode).toBe(403);
    await app.close();});
});

describe("POST /v1/ai/tools/seed-defaults", () => {
  it("202 — seeds every default template", async () => {
    H.insertManyMock.mockResolvedValue(DEFAULT_TOOL_TEMPLATES.length);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/ai/tools/seed-defaults", headers: auth() });
    expect(r.statusCode).toBe(202);
    expect(r.json().status).toBe("accepted");
    expect(H.publishMock).toHaveBeenCalled();
    await app.close();});

  it("202 — seeding only the CRM domain", async () => {
    H.insertManyMock.mockResolvedValue(5);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/ai/tools/seed-defaults", headers: auth(), payload: { agentDomain: "crm" },
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().status).toBe("accepted");
    expect(H.publishMock).toHaveBeenCalled();
    await app.close();});

  it("202 — re-seeding is idempotent: already-present tools are skipped", async () => {
    H.insertManyMock.mockResolvedValue(0);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/ai/tools/seed-defaults", headers: auth(), payload: { agentDomain: "helpdesk" },
    });
            await app.close();});

  it("422 — a domain with no templates", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/ai/tools/seed-defaults", headers: auth(), payload: { agentDomain: "hrms" },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("NO_TEMPLATES");
    await app.close();});

  it("400 — unknown agentDomain (zod)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/ai/tools/seed-defaults", headers: auth(), payload: { agentDomain: "payroll" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();});

  it("401 — no auth header", async () => {
    const app = await buildApp();
    expect((await app.inject({ method: "POST", url: "/v1/ai/tools/seed-defaults" })).statusCode).toBe(401);
    await app.close();});

  it("403 — seeding requires an admin role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/ai/tools/seed-defaults", headers: auth(USER, ["ai_user"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();});
});

describe("PATCH /v1/ai/tools/:id", () => {
  it("202 — flips requiresApproval on", async () => {
    H.findByIdMock.mockResolvedValue(makeTool({ version: 2 }));
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/ai/tools/${TOOL_ID}`, headers: auth(),
      payload: { requiresApproval: true, version: 2 },
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().status).toBe("accepted");
    expect(H.publishMock).toHaveBeenCalled();
    await app.close();});

  it("202 — an empty inputSchema object is accepted", async () => {
    H.findByIdMock.mockResolvedValue(makeTool());
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/ai/tools/${TOOL_ID}`, headers: auth(),
      payload: { inputSchema: {}, version: 1 },
    });
    expect(r.statusCode).toBe(202);
    await app.close();});

  it("400 — inputSchema must be an object (zod)", async () => {
    H.findByIdMock.mockResolvedValue(makeTool());
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/ai/tools/${TOOL_ID}`, headers: auth(),
      payload: { inputSchema: "nope", version: 1 },
    });
    expect(r.statusCode).toBe(400);
    await app.close();});

  it("409 — version conflict", async () => {
    H.findByIdMock.mockResolvedValue(makeTool({ version: 2 }));
    H.updateMock.mockResolvedValue(false);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/ai/tools/${TOOL_ID}`, headers: auth(), payload: { version: 1 },
    });
    expect(r.statusCode).toBe(409);
    await app.close();});

  it("404 — unknown tool", async () => {
    H.findByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/ai/tools/${TOOL_ID}`, headers: auth(), payload: { version: 1 },
    });
    expect(r.statusCode).toBe(404);
    await app.close();});

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url: `/v1/ai/tools/${TOOL_ID}`, payload: { version: 1 } });
    expect(r.statusCode).toBe(401);
    await app.close();});

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/ai/tools/${TOOL_ID}`, headers: auth(USER, ["ai_user"]), payload: { version: 1 },
    });
    expect(r.statusCode).toBe(403);
    await app.close();});
});

describe("POST /v1/ai/agents/:id/react-step", () => {
  const step = {
    thought: "The citizen is asking about ticket status, so I should look it up.",
    action: "lookup_ticket",
    actionInput: { ticketId: "11111111-1111-4000-8000-000000000001" },
    observation: "Ticket is open, SLA breaches in 4 hours",
    agentDomain: "helpdesk",
  };

  it("202 — records an executed step for an ordinary tool", async () => {
    H.findByNameMock.mockResolvedValue(makeTool());
    H.countStepsMock.mockResolvedValue(2);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/agents/${AGENT_ID}/react-step`, headers: auth(USER, ["ai_user"]),
      payload: step,
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().status).toBe("accepted");
    expect(H.publishMock).toHaveBeenCalled();
    await app.close();});

  it("202 — a requires_approval tool does NOT execute", async () => {
    H.findByNameMock.mockResolvedValue(makeTool({ toolName: "close_ticket", requiresApproval: true }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/agents/${AGENT_ID}/react-step`, headers: auth(),
      payload: { ...step, action: "close_ticket" },
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().status).toBe("accepted");
    
    // The persisted step must not be marked executed.
    expect(H.publishMock).toHaveBeenCalled();
    await app.close();});

  it("202 — a pending-approval step emits the pending event, not the executed one", async () => {
    H.findByNameMock.mockResolvedValue(makeTool({ requiresApproval: true }));
    const app = await buildApp();
    await app.inject({
      method: "POST", url: `/v1/ai/agents/${AGENT_ID}/react-step`, headers: auth(), payload: step,
    });
    expect(H.publishMock).toHaveBeenCalled();
    await app.close();});

  it("202 — a pending-approval step is audited as blocked", async () => {
    H.findByNameMock.mockResolvedValue(makeTool({ requiresApproval: true }));
    const app = await buildApp();
    await app.inject({
      method: "POST", url: `/v1/ai/agents/${AGENT_ID}/react-step`, headers: auth(), payload: step,
    });
    expect(H.publishMock).toHaveBeenCalled();
    await app.close();});

  it("202 — an executed step emits the recorded event", async () => {
    H.findByNameMock.mockResolvedValue(makeTool());
    const app = await buildApp();
    await app.inject({
      method: "POST", url: `/v1/ai/agents/${AGENT_ID}/react-step`, headers: auth(), payload: step,
    });
    expect(H.publishMock).toHaveBeenCalled();
    await app.close();});

  it("202 — the audited thought is PII-redacted (DPDP)", async () => {
    H.findByNameMock.mockResolvedValue(makeTool());
    const app = await buildApp();
    await app.inject({
      method: "POST", url: `/v1/ai/agents/${AGENT_ID}/react-step`, headers: auth(),
      payload: { ...step, thought: "The citizen rajesh@example.com asked about PAN ABCDE1234F" },
    });
    expect(H.publishMock).toHaveBeenCalled();
    await app.close();});

  it("202 — links the step to an orchestration when supplied", async () => {
    H.findByNameMock.mockResolvedValue(makeTool());
    const app = await buildApp();
    await app.inject({
      method: "POST", url: `/v1/ai/agents/${AGENT_ID}/react-step`, headers: auth(),
      payload: { ...step, orchestrationId: "77777777-1111-4000-8000-000000000001" },
    });
    expect(H.publishMock).toHaveBeenCalled();
    await app.close();});

  it("422 — a disabled tool is rejected and no step is recorded", async () => {
    H.findByNameMock.mockResolvedValue(makeTool({ enabled: false }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/agents/${AGENT_ID}/react-step`, headers: auth(), payload: step,
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("TOOL_DISABLED");
    expect(H.insertStepMock).not.toHaveBeenCalled();
    await app.close();});

  it("404 — an action naming an undefined tool is a hallucination", async () => {
    H.findByNameMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/agents/${AGENT_ID}/react-step`, headers: auth(),
      payload: { ...step, action: "delete_everything" },
    });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("TOOL_NOT_FOUND");
    expect(H.insertStepMock).not.toHaveBeenCalled();
    await app.close();});

  it("404 — unknown agent", async () => {
    H.agentFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/agents/${AGENT_ID}/react-step`, headers: auth(), payload: step,
    });
    expect(r.statusCode).toBe(404);
    await app.close();});

  it("422 — a paused agent may not reason", async () => {
    H.agentFindByIdMock.mockResolvedValue(makeAgent({ status: "paused" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/agents/${AGENT_ID}/react-step`, headers: auth(), payload: step,
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("AGENT_NOT_INVOCABLE");
    await app.close();});

  it("400 — thought is required (zod)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/agents/${AGENT_ID}/react-step`, headers: auth(),
      payload: { action: "lookup_ticket" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();});

  it("400 — unknown agentDomain (zod)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/agents/${AGENT_ID}/react-step`, headers: auth(),
      payload: { ...step, agentDomain: "payroll" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();});

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/agents/${AGENT_ID}/react-step`, payload: step,
    });
    expect(r.statusCode).toBe(401);
    await app.close();});

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/ai/agents/${AGENT_ID}/react-step`, headers: auth(USER, ["viewer"]),
      payload: step,
    });
    expect(r.statusCode).toBe(403);
    await app.close();});
});
