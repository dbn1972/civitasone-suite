/**
 * CR-CDP-03 — versioned event attribute schemas.
 * Unit coverage of the version lifecycle, revision numbering, active-version selection and
 * breaking-change diff, plus route coverage for list/create/activate/deprecate/validate
 * (happy path + 400/401/403/404/409/422).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import {
  VERSION_STATUSES,
  canTransitionVersion,
  nextSchemaVersion,
  selectActiveVersion,
  findVersion,
  diffSchemas,
  validateAgainstVersion,
} from "../src/modules/events/taxonomy-version-domain.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const TAX_ID = "ffffffff-2222-4000-8000-000000000001";
const VER_ID = "ffffffff-3333-4000-8000-000000000001";

// ── PURE: lifecycle ───────────────────────────────────────────────────────────

describe("canTransitionVersion", () => {
  it("exposes the three documented statuses", () => {
    expect([...VERSION_STATUSES]).toEqual(["draft", "active", "deprecated"]);
  });

  it("allows draft → active and draft → deprecated", () => {
    expect(canTransitionVersion("draft", "active")).toBe(true);
    expect(canTransitionVersion("draft", "deprecated")).toBe(true);
  });

  it("never returns an activated revision to draft", () => {
    expect(canTransitionVersion("active", "draft")).toBe(false);
    expect(canTransitionVersion("active", "deprecated")).toBe(true);
  });

  it("treats deprecated as terminal", () => {
    expect(canTransitionVersion("deprecated", "active")).toBe(false);
    expect(canTransitionVersion("deprecated", "draft")).toBe(false);
    expect(canTransitionVersion("deprecated", "deprecated")).toBe(true);
  });

  it("permits an idempotent no-op", () => {
    expect(canTransitionVersion("draft", "draft")).toBe(true);
    expect(canTransitionVersion("active", "active")).toBe(true);
  });

  it("rejects an unknown starting status", () => {
    expect(canTransitionVersion("retired", "active")).toBe(false);
  });
});

// ── PURE: numbering and selection ─────────────────────────────────────────────

describe("nextSchemaVersion", () => {
  it("starts at 1", () => {
    expect(nextSchemaVersion([])).toBe(1);
  });

  it("continues past the highest number that ever existed", () => {
    expect(nextSchemaVersion([
      { schemaVersion: 1, status: "deprecated" },
      { schemaVersion: 2, status: "deprecated" },
      { schemaVersion: 3, status: "active" },
    ])).toBe(4);
  });

  it("does not reuse a retired number even if it is the only one left", () => {
    expect(nextSchemaVersion([{ schemaVersion: 7, status: "deprecated" }])).toBe(8);
  });

  it("ignores a non-integer revision number", () => {
    expect(nextSchemaVersion([{ schemaVersion: Number.NaN, status: "draft" }])).toBe(1);
    expect(nextSchemaVersion([{ schemaVersion: 1.5, status: "draft" }])).toBe(1);
  });
});

describe("selectActiveVersion", () => {
  it("returns the active revision", () => {
    const rows = [
      { schemaVersion: 1, status: "deprecated" },
      { schemaVersion: 2, status: "active" },
      { schemaVersion: 3, status: "draft" },
    ];
    expect(selectActiveVersion(rows)?.schemaVersion).toBe(2);
  });

  it("returns null when nothing is in force", () => {
    expect(selectActiveVersion([{ schemaVersion: 1, status: "draft" }])).toBeNull();
    expect(selectActiveVersion([])).toBeNull();
  });

  it("resolves to the newest if two rows are somehow active", () => {
    expect(selectActiveVersion([
      { schemaVersion: 2, status: "active" },
      { schemaVersion: 5, status: "active" },
    ])?.schemaVersion).toBe(5);
  });
});

describe("findVersion", () => {
  it("finds a revision by number", () => {
    expect(findVersion([{ schemaVersion: 2, status: "draft" }], 2)?.status).toBe("draft");
  });

  it("returns null for an unknown number", () => {
    expect(findVersion([{ schemaVersion: 2, status: "draft" }], 9)).toBeNull();
  });
});

// ── PURE: diffSchemas ─────────────────────────────────────────────────────────

describe("diffSchemas", () => {
  it("reports no change between identical schemas", () => {
    const s = { orderId: { type: "string", required: true } };
    expect(diffSchemas(s, s)).toEqual({
      breaking: false, addedRequired: [], addedOptional: [], removed: [],
      typeChanged: [], requirementTightened: [], requirementRelaxed: [],
    });
  });

  it("treats an added optional field as non-breaking", () => {
    const d = diffSchemas({ a: { type: "string" } }, { a: { type: "string" }, b: { type: "number" } });
    expect(d.addedOptional).toEqual(["b"]);
    expect(d.breaking).toBe(false);
  });

  it("treats an added required field as breaking", () => {
    const d = diffSchemas({ a: { type: "string" } }, { a: { type: "string" }, b: { type: "number", required: true } });
    expect(d.addedRequired).toEqual(["b"]);
    expect(d.breaking).toBe(true);
  });

  it("treats a removed field as breaking", () => {
    const d = diffSchemas({ a: { type: "string" }, b: { type: "number" } }, { a: { type: "string" } });
    expect(d.removed).toEqual(["b"]);
    expect(d.breaking).toBe(true);
  });

  it("treats a type change as breaking", () => {
    const d = diffSchemas({ a: { type: "string" } }, { a: { type: "number" } });
    expect(d.typeChanged).toEqual([{ field: "a", from: "string", to: "number" }]);
    expect(d.breaking).toBe(true);
  });

  it("treats tightening optional → required as breaking", () => {
    const d = diffSchemas({ a: { type: "string" } }, { a: { type: "string", required: true } });
    expect(d.requirementTightened).toEqual(["a"]);
    expect(d.breaking).toBe(true);
  });

  it("treats relaxing required → optional as safe but records it", () => {
    const d = diffSchemas({ a: { type: "string", required: true } }, { a: { type: "string" } });
    expect(d.requirementRelaxed).toEqual(["a"]);
    expect(d.breaking).toBe(false);
  });

  it("treats a first revision as an addition, breaking only if required", () => {
    expect(diffSchemas({}, { a: { type: "string" } }).breaking).toBe(false);
    expect(diffSchemas({}, { a: { type: "string", required: true } }).breaking).toBe(true);
  });

  it("ignores malformed entries on either side", () => {
    const d = diffSchemas({ a: "nonsense" }, { a: "still nonsense", b: { type: "string" } });
    expect(d.removed).toEqual([]);
    expect(d.addedOptional).toEqual(["b"]);
    expect(d.breaking).toBe(false);
  });

  it("treats a spec with no declared type as unknown rather than crashing", () => {
    const d = diffSchemas({ a: {} }, { a: { type: "string" } });
    expect(d.typeChanged).toEqual([{ field: "a", from: "unknown", to: "string" }]);
  });

  it("reports fields in a stable sorted order", () => {
    const d = diffSchemas({}, { zeta: { type: "string" }, alpha: { type: "string" } });
    expect(d.addedOptional).toEqual(["alpha", "zeta"]);
  });
});

// ── PURE: validateAgainstVersion ──────────────────────────────────────────────

describe("validateAgainstVersion", () => {
  const version = {
    schemaVersion: 3,
    schemaJson: { orderId: { type: "string", required: true }, amountMinor: { type: "string" } },
  };

  it("accepts a satisfying payload and names the contract applied", () => {
    const r = validateAgainstVersion({ orderId: "o-1", amountMinor: "125000" }, version);
    expect(r).toEqual({ valid: true, schemaVersion: 3, violations: [], unknownFields: [] });
  });

  it("reports a missing required field against the right revision", () => {
    const r = validateAgainstVersion({ amountMinor: "1" }, version);
    expect(r.valid).toBe(false);
    expect(r.schemaVersion).toBe(3);
    expect(r.violations).toEqual([{ field: "orderId", reason: "required field is missing" }]);
  });

  it("reports unknown fields without failing", () => {
    const r = validateAgainstVersion({ orderId: "o-1", campaign: "diwali" }, version);
    expect(r.valid).toBe(true);
    expect(r.unknownFields).toEqual(["campaign"]);
  });

  it("rejects a money value sent as a JSON number, since the contract says string", () => {
    const r = validateAgainstVersion({ orderId: "o-1", amountMinor: 125000 }, version);
    expect(r.valid).toBe(false);
    expect(r.violations).toEqual([{ field: "amountMinor", reason: "expected string, received number" }]);
  });
});

// ── ROUTES ────────────────────────────────────────────────────────────────────

const H = vi.hoisted(() => ({
  dbTransactionMock: vi.fn(),
  taxFindByIdMock: vi.fn(),
  taxFindByEventNameMock: vi.fn(),
  listPagedMock: vi.fn(),
  listByTaxonomyMock: vi.fn(),
  findByVersionNumberMock: vi.fn(),
  insertMock: vi.fn(),
  setStatusMock: vi.fn(),
  deprecateActiveMock: vi.fn(),
  enqueueMock: vi.fn(),
  publishMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => H.dbTransactionMock(cb) },
  scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  sqlClient: { end: async () => {} },
}));

vi.mock("../src/shared/outbox.js", () => ({ enqueue: (...a: unknown[]) => H.enqueueMock(...a) }));

vi.mock("../src/shared/infra.js", () => ({
  cache: { getOrLoad: vi.fn(), invalidate: vi.fn(), makeKey: vi.fn(() => "k") },
  queue: { publish: (...a: unknown[]) => H.publishMock(...a) },
}));

vi.mock("../src/modules/events/taxonomy-repo.js", () => ({
  findById: (...a: unknown[]) => H.taxFindByIdMock(...a),
  findByEventName: (...a: unknown[]) => H.taxFindByEventNameMock(...a),
  listByTenant: vi.fn(async () => ({ rows: [], total: 0 })),
  insert: vi.fn(),
  update: vi.fn(async () => true),
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/events/taxonomy-version-repo.js", () => ({
  listPaged: (...a: unknown[]) => H.listPagedMock(...a),
  listByTaxonomy: (...a: unknown[]) => H.listByTaxonomyMock(...a),
  findByVersionNumber: (...a: unknown[]) => H.findByVersionNumberMock(...a),
  insert: (...a: unknown[]) => H.insertMock(...a),
  setStatus: (...a: unknown[]) => H.setStatusMock(...a),
  deprecateActive: (...a: unknown[]) => H.deprecateActiveMock(...a),
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
    schemaJson: {},
    status: "approved",
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: USER,
    updatedBy: USER,
    ...overrides,
  };
}

function makeVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: VER_ID,
    tenantId: TENANT,
    taxonomyId: TAX_ID,
    schemaVersion: 1,
    schemaJson: { orderId: { type: "string", required: true } },
    status: "draft",
    notes: null,
    activatedAt: null,
    deprecatedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: USER,
    updatedBy: USER,
    version: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.dbTransactionMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb({}));
  H.enqueueMock.mockResolvedValue(undefined);
  H.publishMock.mockResolvedValue("m");
  H.insertMock.mockResolvedValue(undefined);
  H.setStatusMock.mockResolvedValue(true);
  H.deprecateActiveMock.mockResolvedValue(0);
  H.listPagedMock.mockResolvedValue({ rows: [], total: 0 });
  H.listByTaxonomyMock.mockResolvedValue([]);
  H.taxFindByIdMock.mockResolvedValue(makeTaxonomy());
  H.taxFindByEventNameMock.mockResolvedValue(makeTaxonomy());
});

describe("GET /v1/cdp/events/taxonomy/:id/versions", () => {
  const url = `/v1/cdp/events/taxonomy/${TAX_ID}/versions?limit=10`;

  it("200 — paginated revision history", async () => {
    H.listPagedMock.mockResolvedValue({ rows: [makeVersion()], total: 1 });
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    expect(r.json().meta).toEqual({ page: 1, pageSize: 10, total: 1 });
    await app.close();
  });

  it("400 — limit is mandatory", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/cdp/events/taxonomy/${TAX_ID}/versions`, headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("404 — unknown taxonomy", async () => {
    H.taxFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: auth() });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — role without cdp access", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: auth(["viewer"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("POST /v1/cdp/events/taxonomy/:id/versions", () => {
  const url = `/v1/cdp/events/taxonomy/${TAX_ID}/versions`;
  const payload = { schemaJson: { orderId: { type: "string", required: true } }, notes: "first cut" };

  it("202 — publishes draft revision create command", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload });
    expect(r.statusCode).toBe(202);
    expect(r.json().data.schemaVersion).toBe(1);
    expect(r.json().data.status).toBe("accepted");
    expect(r.json().data.comparedWith).toBeNull();
    expect(H.publishMock).toHaveBeenCalledWith(
      "cdp.f3.route_write",
      expect.objectContaining({ payload: expect.objectContaining({ op: "taxonomy_version_create", schemaVersion: 1 }) }),
    );
    expect(H.insertMock).not.toHaveBeenCalled();
    expect(H.enqueueMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("202 — numbers the next revision past every existing one", async () => {
    H.listByTaxonomyMock.mockResolvedValue([
      makeVersion({ schemaVersion: 1, status: "deprecated" }),
      makeVersion({ schemaVersion: 2, status: "active" }),
    ]);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload });
    expect(r.statusCode).toBe(202);
    expect(r.json().data.schemaVersion).toBe(3);
    expect(r.json().data.comparedWith).toBe(2);
    await app.close();
  });

  it("202 — flags a breaking change against the revision in force", async () => {
    H.listByTaxonomyMock.mockResolvedValue([
      makeVersion({ schemaVersion: 1, status: "active", schemaJson: { orderId: { type: "string" } } }),
    ]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url, headers: auth(),
      payload: { schemaJson: { orderId: { type: "number", required: true } } },
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().data.diff.breaking).toBe(true);
    expect(r.json().data.diff.typeChanged).toEqual([{ field: "orderId", from: "string", to: "number" }]);
    await app.close();
  });

  it("202 — a purely additive optional change is not breaking", async () => {
    H.listByTaxonomyMock.mockResolvedValue([
      makeVersion({ schemaVersion: 1, status: "active", schemaJson: { orderId: { type: "string" } } }),
    ]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url, headers: auth(),
      payload: { schemaJson: { orderId: { type: "string" }, coupon: { type: "string" } } },
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().data.diff.breaking).toBe(false);
    await app.close();
  });

  it("400 — schema definition uses an unsupported type", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url, headers: auth(), payload: { schemaJson: { when: { type: "date" } } },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("INVALID_SCHEMA");
    await app.close();
  });

  it("400 — notes longer than the column", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url, headers: auth(), payload: { ...payload, notes: "x".repeat(501) },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("404 — unknown taxonomy", async () => {
    H.taxFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, payload });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — a plain cdp user cannot author a schema revision", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(["cdp_user"]), payload });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("POST /v1/cdp/events/taxonomy/:id/versions/:schemaVersion/activate", () => {
  const url = `/v1/cdp/events/taxonomy/${TAX_ID}/versions/2/activate`;

  it("202 — a steward publishes activate command for a draft revision", async () => {
    H.findByVersionNumberMock.mockResolvedValue(makeVersion({ schemaVersion: 2 }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(["cdp_steward"]), payload: { version: 1 } });
    expect(r.statusCode).toBe(202);
    expect(r.json().data.status).toBe("accepted");
    expect(r.json().data.version).toBe(2);
    expect(H.publishMock).toHaveBeenCalledWith(
      "cdp.f3.route_write",
      expect.objectContaining({ payload: expect.objectContaining({ op: "taxonomy_version_activate", schemaVersion: 2 }) }),
    );
    expect(H.setStatusMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("202 — activating the first revision still publishes", async () => {
    H.findByVersionNumberMock.mockResolvedValue(makeVersion({ schemaVersion: 2 }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: { version: 1 } });
    expect(r.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalled();
    await app.close();
  });

  it("400 — version is required", async () => {
    H.findByVersionNumberMock.mockResolvedValue(makeVersion({ schemaVersion: 2 }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: {} });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — schemaVersion must be a positive integer", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/cdp/events/taxonomy/${TAX_ID}/versions/0/activate`,
      headers: auth(), payload: { version: 1 },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("404 — unknown taxonomy", async () => {
    H.taxFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: { version: 1 } });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("404 — unknown revision", async () => {
    H.findByVersionNumberMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: { version: 1 } });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("202 — version conflicts deferred to consumer", async () => {
    H.findByVersionNumberMock.mockResolvedValue(makeVersion({ schemaVersion: 2 }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: { version: 1 } });
    expect(r.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalled();
    expect(H.setStatusMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("422 — a deprecated revision cannot be revived", async () => {
    H.findByVersionNumberMock.mockResolvedValue(makeVersion({ schemaVersion: 2, status: "deprecated" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: { version: 1 } });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("INVALID_TRANSITION");
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, payload: { version: 1 } });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — a plain cdp user cannot activate a contract", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(["cdp_user"]), payload: { version: 1 } });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("POST /v1/cdp/events/taxonomy/:id/versions/:schemaVersion/deprecate", () => {
  const url = `/v1/cdp/events/taxonomy/${TAX_ID}/versions/1/deprecate`;

  it("202 — publishes deprecate command for an active revision", async () => {
    H.findByVersionNumberMock.mockResolvedValue(makeVersion({ status: "active" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(["cdp_steward"]), payload: { version: 4 } });
    expect(r.statusCode).toBe(202);
    expect(r.json().data.status).toBe("accepted");
    expect(r.json().data.version).toBe(5);
    expect(H.publishMock).toHaveBeenCalledWith(
      "cdp.f3.route_write",
      expect.objectContaining({ payload: expect.objectContaining({ op: "taxonomy_version_deprecate" }) }),
    );
    expect(H.setStatusMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("202 — retiring a draft is allowed (abandoned authoring)", async () => {
    H.findByVersionNumberMock.mockResolvedValue(makeVersion({ status: "draft" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: { version: 1 } });
    expect(r.statusCode).toBe(202);
    await app.close();
  });

  it("404 — unknown revision", async () => {
    H.findByVersionNumberMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: { version: 1 } });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("202 — version conflicts deferred to consumer", async () => {
    H.findByVersionNumberMock.mockResolvedValue(makeVersion({ status: "active" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: { version: 1 } });
    expect(r.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalled();
    expect(H.setStatusMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("400 — version is required", async () => {
    H.findByVersionNumberMock.mockResolvedValue(makeVersion({ status: "active" }));
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

  it("403 — a plain cdp user cannot retire a contract", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(["cdp_user"]), payload: { version: 1 } });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("POST /v1/cdp/events/validate-versioned", () => {
  const url = "/v1/cdp/events/validate-versioned";

  it("200 — validates against the revision in force when none is named", async () => {
    H.listByTaxonomyMock.mockResolvedValue([
      makeVersion({ schemaVersion: 1, status: "deprecated", schemaJson: { legacyId: { type: "string", required: true } } }),
      makeVersion({ schemaVersion: 2, status: "active" }),
    ]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url, headers: auth(["cdp_user"]),
      payload: { eventName: "order_placed", payload: { orderId: "o-1" } },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.schemaVersion).toBe(2);
    expect(r.json().data.schemaStatus).toBe("active");
    await app.close();
  });

  it("200 — validates an archived event against the contract it was captured under", async () => {
    H.listByTaxonomyMock.mockResolvedValue([
      makeVersion({ schemaVersion: 1, status: "deprecated", schemaJson: { legacyId: { type: "string", required: true } } }),
      makeVersion({ schemaVersion: 2, status: "active" }),
    ]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url, headers: auth(),
      payload: { eventName: "order_placed", payload: { legacyId: "L-1" }, schemaVersion: 1 },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.schemaVersion).toBe(1);
    expect(r.json().data.schemaStatus).toBe("deprecated");
    await app.close();
  });

  it("200 — unknown fields are reported, not rejected", async () => {
    H.listByTaxonomyMock.mockResolvedValue([makeVersion({ status: "active" })]);
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
    H.taxFindByEventNameMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url, headers: auth(), payload: { eventName: "undeclared_thing", payload: {} },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("UNKNOWN_EVENT_NAME");
    await app.close();
  });

  it("422 — no revision is in force", async () => {
    H.listByTaxonomyMock.mockResolvedValue([makeVersion({ status: "draft" })]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url, headers: auth(), payload: { eventName: "order_placed", payload: { orderId: "o-1" } },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("NO_ACTIVE_SCHEMA_VERSION");
    await app.close();
  });

  it("422 — payload violates the named revision", async () => {
    H.listByTaxonomyMock.mockResolvedValue([makeVersion({ status: "active" })]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url, headers: auth(), payload: { eventName: "order_placed", payload: {} },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("PAYLOAD_SCHEMA_VIOLATION");
    await app.close();
  });

  it("404 — an explicitly named revision does not exist", async () => {
    H.listByTaxonomyMock.mockResolvedValue([makeVersion({ status: "active" })]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url, headers: auth(),
      payload: { eventName: "order_placed", payload: { orderId: "o-1" }, schemaVersion: 9 },
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("400 — event name is required", async () => {
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
