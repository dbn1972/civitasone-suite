/**
 * CDP-004 — event taxonomy governance.
 * Unit coverage of the pure taxonomy functions + route coverage for list/create/patch/
 * approve/validate (happy path + 400/401/403/404/409/422).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import {
  canTransition,
  validateSchemaDefinition,
  validatePayload,
} from "../src/modules/events/taxonomy-domain.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const TAX_ID = "ffffffff-1111-4000-8000-000000000001";

// ── PURE: canTransition ───────────────────────────────────────────────────────

describe("canTransition", () => {
  it("allows draft → approved and draft → deprecated", () => {
    expect(canTransition("draft", "approved")).toBe(true);
    expect(canTransition("draft", "deprecated")).toBe(true);
  });

  it("allows approved → deprecated but never back to draft", () => {
    expect(canTransition("approved", "deprecated")).toBe(true);
    expect(canTransition("approved", "draft")).toBe(false);
  });

  it("treats deprecated as terminal", () => {
    expect(canTransition("deprecated", "approved")).toBe(false);
    expect(canTransition("deprecated", "draft")).toBe(false);
    expect(canTransition("deprecated", "deprecated")).toBe(true);
  });

  it("permits an idempotent no-op transition", () => {
    expect(canTransition("draft", "draft")).toBe(true);
    expect(canTransition("approved", "approved")).toBe(true);
  });

  it("rejects an unknown starting status", () => {
    expect(canTransition("retired", "approved")).toBe(false);
  });
});

// ── PURE: validateSchemaDefinition ────────────────────────────────────────────

describe("validateSchemaDefinition", () => {
  it("accepts an empty definition", () => {
    expect(validateSchemaDefinition({})).toBeNull();
  });

  it("accepts every supported field type", () => {
    expect(validateSchemaDefinition({
      a: { type: "string" }, b: { type: "number" }, c: { type: "boolean" },
      d: { type: "object" }, e: { type: "array", required: true },
    })).toBeNull();
  });

  it("rejects a non-object field spec", () => {
    expect(validateSchemaDefinition({ a: "string" })).toContain('field "a"');
    expect(validateSchemaDefinition({ a: null })).toContain('field "a"');
    expect(validateSchemaDefinition({ a: ["string"] })).toContain('field "a"');
  });

  it("rejects an unsupported type", () => {
    expect(validateSchemaDefinition({ a: { type: "date" } })).toContain("unsupported type");
  });

  it("rejects a non-boolean required flag", () => {
    expect(validateSchemaDefinition({ a: { type: "string", required: "yes" } })).toContain("non-boolean");
  });
});

// ── PURE: validatePayload ─────────────────────────────────────────────────────

describe("validatePayload", () => {
  const schema = {
    orderId: { type: "string", required: true },
    amount: { type: "number", required: true },
    isGift: { type: "boolean" },
    items: { type: "array" },
    meta: { type: "object" },
  };

  it("accepts a payload that satisfies the contract", () => {
    const result = validatePayload(
      { orderId: "o-1", amount: 10, isGift: false, items: [], meta: {} },
      schema,
    );
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.unknownFields).toEqual([]);
  });

  it("reports a missing required field", () => {
    const result = validatePayload({ amount: 10 }, schema);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([{ field: "orderId", reason: "required field is missing" }]);
  });

  it("treats an explicit null as missing", () => {
    const result = validatePayload({ orderId: null, amount: 10 }, schema);
    expect(result.valid).toBe(false);
    expect(result.violations[0]?.field).toBe("orderId");
  });

  it("reports a type mismatch, distinguishing array from object", () => {
    const result = validatePayload({ orderId: "o-1", amount: "10", items: {}, meta: [] }, schema);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      { field: "amount", reason: "expected number, received string" },
      { field: "items", reason: "expected array, received object" },
      { field: "meta", reason: "expected object, received array" },
    ]);
  });

  it("allows an absent optional field", () => {
    expect(validatePayload({ orderId: "o-1", amount: 10 }, schema).valid).toBe(true);
  });

  it("reports unknown fields without failing validation", () => {
    const result = validatePayload({ orderId: "o-1", amount: 10, campaign: "diwali" }, schema);
    expect(result.valid).toBe(true);
    expect(result.unknownFields).toEqual(["campaign"]);
  });

  it("ignores malformed entries in the stored schema rather than crashing", () => {
    expect(validatePayload({ a: 1 }, { a: "not-a-spec" }).valid).toBe(true);
  });

  it("accepts anything against an empty schema", () => {
    const result = validatePayload({ anything: 1 }, {});
    expect(result.valid).toBe(true);
    expect(result.unknownFields).toEqual(["anything"]);
  });
});

// ── ROUTES ────────────────────────────────────────────────────────────────────

const H = vi.hoisted(() => ({
  dbTransactionMock: vi.fn(),
  findByIdMock: vi.fn(),
  findByEventNameMock: vi.fn(),
  listMock: vi.fn(),
  insertMock: vi.fn(),
  updateMock: vi.fn(),
  enqueueMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => H.dbTransactionMock(cb) },
  scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  sqlClient: { end: async () => {} },
}));

vi.mock("../src/shared/outbox.js", () => ({ enqueue: (...a: unknown[]) => H.enqueueMock(...a) }));

vi.mock("../src/shared/infra.js", () => ({
  cache: { getOrLoad: vi.fn(), invalidate: vi.fn(), makeKey: vi.fn(() => "k") },
  queue: { publish: vi.fn(async () => "m") },
}));

vi.mock("../src/modules/events/taxonomy-repo.js", () => ({
  findById: (...a: unknown[]) => H.findByIdMock(...a),
  findByEventName: (...a: unknown[]) => H.findByEventNameMock(...a),
  listByTenant: (...a: unknown[]) => H.listMock(...a),
  insert: (...a: unknown[]) => H.insertMock(...a),
  update: (...a: unknown[]) => H.updateMock(...a),
  toView: (r: Record<string, unknown>) => r,
}));

const { buildApp } = await import("../src/app.js");

const auth = (roles = ["cdp_admin"]) => ({
  authorization: `Bearer ${signToken({ sub: USER, tid: TENANT, roles, sid: "s" }, SECRET)}`,
});

function makeTaxonomy(overrides: Record<string, unknown> = {}) {
  return {
    id: TAX_ID,
    tenantId: TENANT,
    eventName: "order_placed",
    category: "transactional",
    schemaJson: { orderId: { type: "string", required: true } },
    status: "draft",
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: USER,
    updatedBy: USER,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.dbTransactionMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb({}));
  H.enqueueMock.mockResolvedValue(undefined);
  H.insertMock.mockResolvedValue(undefined);
  H.updateMock.mockResolvedValue(true);
  H.listMock.mockResolvedValue({ rows: [], total: 0 });
  H.findByEventNameMock.mockResolvedValue(null);
});

describe("GET /v1/cdp/events/taxonomy", () => {
  it("200 — paginated list envelope", async () => {
    H.listMock.mockResolvedValue({ rows: [makeTaxonomy()], total: 1 });
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/cdp/events/taxonomy?limit=10", headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    expect(r.json().meta).toEqual({ page: 1, pageSize: 10, total: 1 });
    await app.close();
  });

  it("200 — passes the status filter through", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: "/v1/cdp/events/taxonomy?status=approved", headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(H.listMock).toHaveBeenCalledWith(TENANT, 50, 0, { status: "approved" });
    await app.close();
  });

  it("400 — limit above the 200 cap", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/cdp/events/taxonomy?limit=201", headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/cdp/events/taxonomy" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — role without cdp access", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/cdp/events/taxonomy", headers: auth(["viewer"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("POST /v1/cdp/events/taxonomy", () => {
  const payload = { eventName: "order_placed", category: "transactional", schemaJson: { orderId: { type: "string" } } };

  it("201 — registers a draft definition", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/cdp/events/taxonomy", headers: auth(), payload });
    expect(r.statusCode).toBe(201);
    // Registration is never approval.
    expect(r.json().data.status).toBe("draft");
    expect(H.insertMock).toHaveBeenCalledOnce();
    expect(H.enqueueMock).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it("400 — event name is not lower_snake_case", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/cdp/events/taxonomy", headers: auth(),
      payload: { ...payload, eventName: "Order Placed" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — schema definition uses an unsupported type", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/cdp/events/taxonomy", headers: auth(),
      payload: { ...payload, schemaJson: { when: { type: "date" } } },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code ?? r.json().error?.code).toBeDefined();
    await app.close();
  });

  it("409 — event name already registered", async () => {
    H.findByEventNameMock.mockResolvedValue(makeTaxonomy());
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/cdp/events/taxonomy", headers: auth(), payload });
    expect(r.statusCode).toBe(409);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/cdp/events/taxonomy", payload });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — a plain cdp user cannot register events", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/cdp/events/taxonomy", headers: auth(["cdp_user"]), payload,
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("PATCH /v1/cdp/events/taxonomy/:id", () => {
  const url = `/v1/cdp/events/taxonomy/${TAX_ID}`;

  it("200 — amends the category and schema", async () => {
    H.findByIdMock.mockResolvedValue(makeTaxonomy());
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url, headers: auth(),
      payload: { category: "behavioural", schemaJson: { orderId: { type: "string", required: true } }, version: 1 },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.version).toBe(2);
    await app.close();
  });

  it("400 — invalid schema definition", async () => {
    H.findByIdMock.mockResolvedValue(makeTaxonomy());
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url, headers: auth(), payload: { schemaJson: { a: { type: "uuid" } }, version: 1 },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("404 — unknown definition", async () => {
    H.findByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url, headers: auth(), payload: { version: 1 } });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("409 — stale version", async () => {
    H.findByIdMock.mockResolvedValue(makeTaxonomy());
    H.updateMock.mockResolvedValue(false);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url, headers: auth(), payload: { category: "behavioural", version: 1 },
    });
    expect(r.statusCode).toBe(409);
    await app.close();
  });

  it("422 — illegal status transition", async () => {
    H.findByIdMock.mockResolvedValue(makeTaxonomy({ status: "deprecated" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url, headers: auth(), payload: { status: "approved", version: 1 },
    });
    expect(r.statusCode).toBe(422);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url, payload: { version: 1 } });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url, headers: auth(["cdp_user"]), payload: { version: 1 } });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("POST /v1/cdp/events/taxonomy/:id/approve", () => {
  const url = `/v1/cdp/events/taxonomy/${TAX_ID}/approve`;

  it("200 — a steward approves a draft", async () => {
    H.findByIdMock.mockResolvedValue(makeTaxonomy());
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url, headers: auth(["cdp_steward"]), payload: { version: 1 },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.status).toBe("approved");
    expect(r.json().data.version).toBe(2);
    await app.close();
  });

  it("404 — unknown definition", async () => {
    H.findByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: { version: 1 } });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("409 — stale version", async () => {
    H.findByIdMock.mockResolvedValue(makeTaxonomy());
    H.updateMock.mockResolvedValue(false);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: { version: 1 } });
    expect(r.statusCode).toBe(409);
    await app.close();
  });

  it("422 — a deprecated definition cannot be approved", async () => {
    H.findByIdMock.mockResolvedValue(makeTaxonomy({ status: "deprecated" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: { version: 1 } });
    expect(r.statusCode).toBe(422);
    await app.close();
  });

  it("400 — missing version", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: {} });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, payload: { version: 1 } });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — a plain cdp user cannot approve", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(["cdp_user"]), payload: { version: 1 } });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("POST /v1/cdp/events/validate", () => {
  const url = "/v1/cdp/events/validate";

  it("200 — payload satisfies the approved contract", async () => {
    H.findByEventNameMock.mockResolvedValue(makeTaxonomy({ status: "approved" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url, headers: auth(),
      payload: { eventName: "order_placed", payload: { orderId: "o-1" } },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.valid).toBe(true);
    await app.close();
  });

  it("200 — unknown fields are reported, not rejected", async () => {
    H.findByEventNameMock.mockResolvedValue(makeTaxonomy({ status: "approved" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url, headers: auth(),
      payload: { eventName: "order_placed", payload: { orderId: "o-1", campaign: "diwali" } },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.unknownFields).toEqual(["campaign"]);
    await app.close();
  });

  it("422 — event name is not in the taxonomy", async () => {
    H.findByEventNameMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url, headers: auth(), payload: { eventName: "undeclared_thing", payload: {} },
    });
    expect(r.statusCode).toBe(422);
    await app.close();
  });

  it("422 — event name is deprecated", async () => {
    H.findByEventNameMock.mockResolvedValue(makeTaxonomy({ status: "deprecated" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url, headers: auth(), payload: { eventName: "order_placed", payload: { orderId: "o-1" } },
    });
    expect(r.statusCode).toBe(422);
    await app.close();
  });

  it("422 — event name is still a draft", async () => {
    H.findByEventNameMock.mockResolvedValue(makeTaxonomy({ status: "draft" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url, headers: auth(), payload: { eventName: "order_placed", payload: { orderId: "o-1" } },
    });
    expect(r.statusCode).toBe(422);
    await app.close();
  });

  it("422 — payload violates the schema", async () => {
    H.findByEventNameMock.mockResolvedValue(makeTaxonomy({ status: "approved" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url, headers: auth(), payload: { eventName: "order_placed", payload: {} },
    });
    expect(r.statusCode).toBe(422);
    await app.close();
  });

  it("400 — missing event name", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: { payload: {} } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, payload: { eventName: "order_placed" } });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — role without cdp access", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url, headers: auth(["viewer"]), payload: { eventName: "order_placed" },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
