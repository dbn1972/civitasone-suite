/**
 * CR-CDP-01 — vertical profile templates + conflict rules.
 * Unit coverage of the pure survivorship logic (every strategy, every tie-break, every
 * type) plus route coverage for list/get/create/patch/resolve/apply
 * (happy path + 400/401/403/404/409/422).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import {
  validateAttributeSpecs,
  validateConflictRules,
  toAttributeSpecs,
  toConflictRules,
  ruleFor,
  resolveConflict,
  matchesType,
  applyTemplate,
  CONFLICT_STRATEGIES,
  type ConflictRule,
  type SourceValue,
  type TemplateSpec,
} from "../src/modules/profiles/template-domain.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const TPL_ID = "cccccccc-1111-4000-8000-000000000001";
const PROFILE_ID = "bbbbbbbb-1111-4000-8000-000000000001";

// ── PURE: validateAttributeSpecs ──────────────────────────────────────────────

describe("validateAttributeSpecs", () => {
  it("accepts an empty list", () => {
    expect(validateAttributeSpecs([])).toBeNull();
  });

  it("accepts every supported type", () => {
    expect(validateAttributeSpecs([
      { name: "email", type: "string", required: true, pii: true },
      { name: "age", type: "number" },
      { name: "optedIn", type: "boolean" },
      { name: "joinedAt", type: "date" },
      { name: "prefs", type: "object" },
      { name: "tags", type: "array" },
      { name: "lifetimeValueMinor", type: "money" },
    ])).toBeNull();
  });

  it("rejects a non-array", () => {
    expect(validateAttributeSpecs({})).toBe("attributes must be an array");
    expect(validateAttributeSpecs(null)).toBe("attributes must be an array");
  });

  it("rejects a non-object entry", () => {
    expect(validateAttributeSpecs(["email"])).toContain("attributes[0] must be an object");
    expect(validateAttributeSpecs([null])).toContain("must be an object");
    expect(validateAttributeSpecs([["email"]])).toContain("must be an object");
  });

  it("rejects a name that is not camelCase", () => {
    expect(validateAttributeSpecs([{ name: "Email", type: "string" }])).toContain("camelCase");
    expect(validateAttributeSpecs([{ name: "", type: "string" }])).toContain("camelCase");
    expect(validateAttributeSpecs([{ name: "e-mail", type: "string" }])).toContain("camelCase");
    expect(validateAttributeSpecs([{ name: 7, type: "string" }])).toContain("camelCase");
    expect(validateAttributeSpecs([{ name: `a${"b".repeat(63)}`, type: "string" }])).toContain("camelCase");
  });

  it("rejects a duplicate name", () => {
    expect(validateAttributeSpecs([
      { name: "email", type: "string" },
      { name: "email", type: "string" },
    ])).toContain("declared twice");
  });

  it("rejects an unsupported type", () => {
    expect(validateAttributeSpecs([{ name: "email", type: "uuid" }])).toContain("must be one of");
    expect(validateAttributeSpecs([{ name: "email" }])).toContain("must be one of");
  });

  it("rejects non-boolean flags", () => {
    expect(validateAttributeSpecs([{ name: "a", type: "string", required: "yes" }])).toContain("required must be a boolean");
    expect(validateAttributeSpecs([{ name: "a", type: "string", pii: 1 }])).toContain("pii must be a boolean");
  });
});

// ── PURE: validateConflictRules ───────────────────────────────────────────────

describe("validateConflictRules", () => {
  it("accepts rules over declared attributes", () => {
    expect(validateConflictRules(
      { email: { strategy: "most_recent" }, phone: { strategy: "highest_source_priority", sourcePriority: ["crm"] } },
      ["email", "phone"],
    )).toBeNull();
  });

  it("accepts an empty rule set", () => {
    expect(validateConflictRules({}, [])).toBeNull();
  });

  it("rejects a non-object", () => {
    expect(validateConflictRules([], [])).toBe("conflictRules must be an object");
    expect(validateConflictRules(null, [])).toBe("conflictRules must be an object");
  });

  it("rejects a rule for an undeclared attribute", () => {
    expect(validateConflictRules({ ghost: { strategy: "most_recent" } }, ["email"]))
      .toContain("undeclared attribute");
  });

  it("rejects a non-object rule", () => {
    expect(validateConflictRules({ email: "most_recent" }, ["email"])).toContain("must be an object");
    expect(validateConflictRules({ email: null }, ["email"])).toContain("must be an object");
  });

  it("rejects an unknown strategy", () => {
    expect(validateConflictRules({ email: { strategy: "coin_flip" } }, ["email"])).toContain("must be one of");
    expect(validateConflictRules({ email: {} }, ["email"])).toContain("must be one of");
  });

  it("rejects a malformed sourcePriority", () => {
    expect(validateConflictRules({ email: { strategy: "most_recent", sourcePriority: "crm" } }, ["email"]))
      .toContain("array of non-empty strings");
    expect(validateConflictRules({ email: { strategy: "most_recent", sourcePriority: [""] } }, ["email"]))
      .toContain("array of non-empty strings");
  });

  it("rejects highest_source_priority with no ordering to apply", () => {
    expect(validateConflictRules({ email: { strategy: "highest_source_priority" } }, ["email"]))
      .toContain("declares no sourcePriority");
    expect(validateConflictRules({ email: { strategy: "highest_source_priority", sourcePriority: [] } }, ["email"]))
      .toContain("declares no sourcePriority");
  });

  it("exposes exactly the three documented strategies", () => {
    expect([...CONFLICT_STRATEGIES]).toEqual(["most_recent", "highest_source_priority", "first_non_null"]);
  });
});

// ── PURE: normalisation helpers ───────────────────────────────────────────────

describe("toAttributeSpecs", () => {
  it("defaults required and pii to false", () => {
    expect(toAttributeSpecs([{ name: "email", type: "string" }])).toEqual([
      { name: "email", type: "string", required: false, pii: false },
    ]);
  });

  it("drops malformed rows rather than throwing", () => {
    expect(toAttributeSpecs([
      { name: "email", type: "string", required: true, pii: true },
      { name: 5, type: "string" },
      { name: "bad", type: "uuid" },
      { name: "alsoBad" },
    ])).toEqual([{ name: "email", type: "string", required: true, pii: true }]);
  });
});

describe("toConflictRules", () => {
  it("keeps a declared strategy and priority", () => {
    expect(toConflictRules(
      { email: { strategy: "first_non_null", sourcePriority: ["crm", "web"] } },
      "most_recent",
      [],
    )).toEqual({ email: { strategy: "first_non_null", sourcePriority: ["crm", "web"] } });
  });

  it("falls back to the template defaults for a malformed rule", () => {
    expect(toConflictRules({ email: { strategy: "nonsense" } }, "first_non_null", ["crm"]))
      .toEqual({ email: { strategy: "first_non_null", sourcePriority: ["crm"] } });
  });

  it("filters non-string entries out of sourcePriority", () => {
    expect(toConflictRules(
      { email: { strategy: "most_recent", sourcePriority: ["crm", 7] } },
      "most_recent",
      [],
    )).toEqual({ email: { strategy: "most_recent", sourcePriority: ["crm"] } });
  });
});

describe("ruleFor", () => {
  const template: TemplateSpec = {
    attributes: [{ name: "email", type: "string", required: false, pii: true }],
    conflictRules: { email: { strategy: "first_non_null", sourcePriority: [] } },
    defaultStrategy: "most_recent",
    sourcePriority: ["crm"],
  };

  it("prefers the attribute's own rule", () => {
    expect(ruleFor(template, "email").strategy).toBe("first_non_null");
  });

  it("falls back to the template default", () => {
    expect(ruleFor(template, "phone")).toEqual({ strategy: "most_recent", sourcePriority: ["crm"] });
  });
});

// ── PURE: resolveConflict ─────────────────────────────────────────────────────

const sv = (attribute: string, value: unknown, source: string, observedAt: string): SourceValue =>
  ({ attribute, value, source, observedAt });

const rule = (strategy: ConflictRule["strategy"], sourcePriority: string[] = []): ConflictRule =>
  ({ strategy, sourcePriority });

describe("resolveConflict", () => {
  const candidates = [
    sv("email", "old@example.gov.in", "legacy", "2024-01-01T00:00:00.000Z"),
    sv("email", "new@example.gov.in", "crm", "2026-01-01T00:00:00.000Z"),
    sv("email", "mid@example.gov.in", "web", "2025-01-01T00:00:00.000Z"),
  ];

  it("most_recent takes the latest observation", () => {
    const d = resolveConflict("email", candidates, rule("most_recent"));
    expect(d?.value).toBe("new@example.gov.in");
    expect(d?.source).toBe("crm");
    expect(d?.contenders).toBe(3);
    expect(d?.conflicted).toBe(true);
  });

  it("highest_source_priority beats recency", () => {
    const d = resolveConflict("email", candidates, rule("highest_source_priority", ["legacy", "crm", "web"]));
    expect(d?.value).toBe("old@example.gov.in");
    expect(d?.source).toBe("legacy");
    expect(d?.strategy).toBe("highest_source_priority");
  });

  it("highest_source_priority ranks an unlisted source last", () => {
    const d = resolveConflict("email", candidates, rule("highest_source_priority", ["web"]));
    expect(d?.source).toBe("web");
  });

  it("highest_source_priority falls through to recency when priority ties", () => {
    const d = resolveConflict("email", candidates, rule("highest_source_priority", ["nobody"]));
    // All three are unlisted, so recency decides.
    expect(d?.source).toBe("crm");
  });

  it("first_non_null takes the earliest observation", () => {
    const d = resolveConflict("email", candidates, rule("first_non_null"));
    expect(d?.value).toBe("old@example.gov.in");
    expect(d?.source).toBe("legacy");
  });

  it("skips null, undefined and blank values", () => {
    const d = resolveConflict("email", [
      sv("email", null, "crm", "2026-01-01T00:00:00.000Z"),
      sv("email", undefined, "web", "2026-02-01T00:00:00.000Z"),
      sv("email", "   ", "kiosk", "2026-03-01T00:00:00.000Z"),
      sv("email", "real@example.gov.in", "legacy", "2020-01-01T00:00:00.000Z"),
    ], rule("most_recent"));
    expect(d?.value).toBe("real@example.gov.in");
    expect(d?.contenders).toBe(1);
    expect(d?.conflicted).toBe(false);
  });

  it("returns null when nothing survives", () => {
    expect(resolveConflict("email", [sv("email", null, "crm", "2026-01-01T00:00:00.000Z")], rule("most_recent")))
      .toBeNull();
    expect(resolveConflict("email", [], rule("most_recent"))).toBeNull();
  });

  it("ignores candidates for other attributes", () => {
    const d = resolveConflict("email", [
      sv("phone", "9876543210", "crm", "2026-01-01T00:00:00.000Z"),
      sv("email", "a@example.gov.in", "web", "2020-01-01T00:00:00.000Z"),
    ], rule("most_recent"));
    expect(d?.value).toBe("a@example.gov.in");
    expect(d?.attribute).toBe("email");
  });

  it("ranks an unparseable timestamp last under most_recent", () => {
    const d = resolveConflict("email", [
      sv("email", "broken@example.gov.in", "crm", "not-a-date"),
      sv("email", "good@example.gov.in", "web", "2020-01-01T00:00:00.000Z"),
    ], rule("most_recent"));
    expect(d?.value).toBe("good@example.gov.in");
  });

  it("ranks an unparseable timestamp last under first_non_null too", () => {
    const d = resolveConflict("email", [
      sv("email", "broken@example.gov.in", "crm", "not-a-date"),
      sv("email", "good@example.gov.in", "web", "2026-01-01T00:00:00.000Z"),
    ], rule("first_non_null"));
    expect(d?.value).toBe("good@example.gov.in");
  });

  it("is deterministic when every signal ties", () => {
    const tied = [
      sv("email", "b@example.gov.in", "zeta", "2026-01-01T00:00:00.000Z"),
      sv("email", "a@example.gov.in", "alpha", "2026-01-01T00:00:00.000Z"),
    ];
    const first = resolveConflict("email", tied, rule("most_recent"));
    const reversed = resolveConflict("email", [...tied].reverse(), rule("most_recent"));
    // Alphabetical source is the final tie-break, so input order cannot change the winner.
    expect(first?.source).toBe("alpha");
    expect(reversed?.source).toBe("alpha");
  });

  it("breaks a most_recent tie on source priority before the source name", () => {
    const d = resolveConflict("email", [
      sv("email", "a@example.gov.in", "alpha", "2026-01-01T00:00:00.000Z"),
      sv("email", "z@example.gov.in", "zeta", "2026-01-01T00:00:00.000Z"),
    ], rule("most_recent", ["zeta", "alpha"]));
    expect(d?.source).toBe("zeta");
  });

  it("breaks a first_non_null tie on source priority", () => {
    const d = resolveConflict("email", [
      sv("email", "a@example.gov.in", "alpha", "2026-01-01T00:00:00.000Z"),
      sv("email", "z@example.gov.in", "zeta", "2026-01-01T00:00:00.000Z"),
    ], rule("first_non_null", ["zeta", "alpha"]));
    expect(d?.source).toBe("zeta");
  });

  it("does not flag agreement between two sources as a conflict", () => {
    const d = resolveConflict("email", [
      sv("email", "same@example.gov.in", "crm", "2026-01-01T00:00:00.000Z"),
      sv("email", "same@example.gov.in", "web", "2025-01-01T00:00:00.000Z"),
    ], rule("most_recent"));
    expect(d?.contenders).toBe(2);
    expect(d?.conflicted).toBe(false);
  });
});

// ── PURE: matchesType ─────────────────────────────────────────────────────────

describe("matchesType", () => {
  it("checks the primitive types", () => {
    expect(matchesType("x", "string")).toBe(true);
    expect(matchesType(1, "string")).toBe(false);
    expect(matchesType(1.5, "number")).toBe(true);
    expect(matchesType(Number.NaN, "number")).toBe(false);
    expect(matchesType(Number.POSITIVE_INFINITY, "number")).toBe(false);
    expect(matchesType(true, "boolean")).toBe(true);
    expect(matchesType("true", "boolean")).toBe(false);
  });

  it("checks dates as parseable ISO strings", () => {
    expect(matchesType("2026-01-01T00:00:00.000Z", "date")).toBe(true);
    expect(matchesType("yesterday", "date")).toBe(false);
    expect(matchesType(1737158400000, "date")).toBe(false);
  });

  it("distinguishes object from array", () => {
    expect(matchesType({}, "object")).toBe(true);
    expect(matchesType([], "object")).toBe(false);
    expect(matchesType(null, "object")).toBe(false);
    expect(matchesType([], "array")).toBe(true);
    expect(matchesType({}, "array")).toBe(false);
  });

  it("requires money to be integer minor units as a string", () => {
    expect(matchesType("125000", "money")).toBe(true);
    expect(matchesType(" 125000 ", "money")).toBe(true);
    expect(matchesType("-125000", "money")).toBe(true);
    // A JSON number is rejected: above 2^53 it silently loses precision.
    expect(matchesType(125000, "money")).toBe(false);
    expect(matchesType("1250.00", "money")).toBe(false);
    expect(matchesType("", "money")).toBe(false);
    expect(matchesType("12a", "money")).toBe(false);
  });
});

// ── PURE: applyTemplate ───────────────────────────────────────────────────────

const spec: TemplateSpec = {
  attributes: [
    { name: "email", type: "string", required: true, pii: true },
    { name: "phone", type: "string", required: false, pii: true },
    { name: "lifetimeValueMinor", type: "money", required: false, pii: false },
  ],
  conflictRules: { phone: { strategy: "highest_source_priority", sourcePriority: ["crm", "web"] } },
  defaultStrategy: "most_recent",
  sourcePriority: [],
};

describe("applyTemplate", () => {
  it("resolves each declared attribute under its own rule", () => {
    const result = applyTemplate(spec, [
      sv("email", "new@example.gov.in", "web", "2026-01-01T00:00:00.000Z"),
      sv("email", "old@example.gov.in", "crm", "2024-01-01T00:00:00.000Z"),
      sv("phone", "9876543210", "crm", "2020-01-01T00:00:00.000Z"),
      sv("phone", "9000000000", "web", "2026-01-01T00:00:00.000Z"),
    ]);
    // email: most_recent (default) → web. phone: source priority → crm.
    expect(result.attributes).toEqual({ email: "new@example.gov.in", phone: "9876543210" });
    expect(result.missingRequired).toEqual([]);
    expect(result.decisions).toHaveLength(2);
    expect(result.decisions.map((d) => d.strategy)).toEqual(["most_recent", "highest_source_priority"]);
  });

  it("reports undeclared attributes and does not write them", () => {
    const result = applyTemplate(spec, [
      sv("email", "a@example.gov.in", "crm", "2026-01-01T00:00:00.000Z"),
      sv("zodiac", "leo", "crm", "2026-01-01T00:00:00.000Z"),
      sv("aadhaar", "x", "crm", "2026-01-01T00:00:00.000Z"),
    ]);
    expect(result.attributes).toEqual({ email: "a@example.gov.in" });
    expect(result.ignoredAttributes).toEqual(["aadhaar", "zodiac"]);
  });

  it("reports a required attribute no source supplied", () => {
    const result = applyTemplate(spec, [sv("phone", "9876543210", "crm", "2026-01-01T00:00:00.000Z")]);
    expect(result.missingRequired).toEqual(["email"]);
    expect(result.attributes.email).toBeUndefined();
  });

  it("withholds a value of the wrong type and counts a required one as missing", () => {
    const result = applyTemplate(spec, [
      sv("email", 42, "crm", "2026-01-01T00:00:00.000Z"),
      sv("lifetimeValueMinor", 125000, "crm", "2026-01-01T00:00:00.000Z"),
    ]);
    expect(result.typeViolations).toEqual([
      { attribute: "email", expected: "string" },
      { attribute: "lifetimeValueMinor", expected: "money" },
    ]);
    expect(result.missingRequired).toEqual(["email"]);
    expect(result.attributes).toEqual({});
  });

  it("accepts money as a minor-unit string", () => {
    const result = applyTemplate(spec, [
      sv("email", "a@example.gov.in", "crm", "2026-01-01T00:00:00.000Z"),
      sv("lifetimeValueMinor", "990000", "crm", "2026-01-01T00:00:00.000Z"),
    ]);
    expect(result.attributes.lifetimeValueMinor).toBe("990000");
  });

  it("returns an empty application for a template with no attributes", () => {
    const result = applyTemplate(
      { attributes: [], conflictRules: {}, defaultStrategy: "most_recent", sourcePriority: [] },
      [sv("email", "a@example.gov.in", "crm", "2026-01-01T00:00:00.000Z")],
    );
    expect(result.attributes).toEqual({});
    expect(result.ignoredAttributes).toEqual(["email"]);
    expect(result.decisions).toEqual([]);
  });
});

// ── ROUTES ────────────────────────────────────────────────────────────────────

const H = vi.hoisted(() => ({
  dbTransactionMock: vi.fn(),
  findByIdMock: vi.fn(),
  findByVerticalMock: vi.fn(),
  listMock: vi.fn(),
  insertMock: vi.fn(),
  updateMock: vi.fn(),
  profileFindByIdMock: vi.fn(),
  profileUpdateMock: vi.fn(),
  enqueueMock: vi.fn(),
  publishMock: vi.fn(async () => "m"),
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

vi.mock("../src/modules/profiles/template-repo.js", () => ({
  findById: (...a: unknown[]) => H.findByIdMock(...a),
  findByVertical: (...a: unknown[]) => H.findByVerticalMock(...a),
  listByTenant: (...a: unknown[]) => H.listMock(...a),
  insert: (...a: unknown[]) => H.insertMock(...a),
  update: (...a: unknown[]) => H.updateMock(...a),
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/profiles/repo.js", () => ({
  findById: (...a: unknown[]) => H.profileFindByIdMock(...a),
  update: (...a: unknown[]) => H.profileUpdateMock(...a),
  insert: vi.fn(),
  listByTenant: vi.fn(async () => ({ rows: [], total: 0 })),
  markMerged: vi.fn(),
  findByIds: vi.fn(async () => []),
  findByIdTx: vi.fn(),
  toView: (r: Record<string, unknown>) => r,
}));

const { buildApp } = await import("../src/app.js");

const auth = (roles = ["cdp_admin"]) => ({
  authorization: `Bearer ${signToken({ sub: USER, tid: TENANT, roles, sid: "s" }, SECRET)}`,
});

function makeTemplate(overrides: Record<string, unknown> = {}) {
  return {
    id: TPL_ID,
    tenantId: TENANT,
    vertical: "retail",
    profileType: "individual",
    label: "Retail individual",
    attributesSpec: [
      { name: "email", type: "string", required: true, pii: true },
      { name: "phone", type: "string" },
    ],
    conflictRules: { phone: { strategy: "highest_source_priority", sourcePriority: ["crm"] } },
    defaultStrategy: "most_recent",
    sourcePriority: ["crm", "web"],
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: USER,
    updatedBy: USER,
    version: 1,
    ...overrides,
  };
}

function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: PROFILE_ID,
    tenantId: TENANT,
    profileType: "individual",
    attributes: { existing: "kept" },
    sourceLineage: [],
    mergedFromIds: [],
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
  H.insertMock.mockResolvedValue(undefined);
  H.updateMock.mockResolvedValue(true);
  H.profileUpdateMock.mockResolvedValue(true);
  H.listMock.mockResolvedValue({ rows: [], total: 0 });
  H.findByVerticalMock.mockResolvedValue(null);
});

describe("GET /v1/cdp/profile-templates", () => {
  it("200 — paginated envelope", async () => {
    H.listMock.mockResolvedValue({ rows: [makeTemplate()], total: 1 });
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/cdp/profile-templates?limit=10", headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    expect(r.json().meta).toEqual({ page: 1, pageSize: 10, total: 1 });
    await app.close();
  });

  it("200 — passes the vertical filter through", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: "/v1/cdp/profile-templates?limit=25&offset=25&vertical=bfsi", headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(H.listMock).toHaveBeenCalledWith(TENANT, 25, 25, { vertical: "bfsi" });
    expect(r.json().meta.page).toBe(2);
    await app.close();
  });

  it("400 — limit is mandatory", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/cdp/profile-templates", headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — limit above the 200 cap", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/cdp/profile-templates?limit=201", headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/cdp/profile-templates?limit=10" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — role without cdp access", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: "/v1/cdp/profile-templates?limit=10", headers: auth(["viewer"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("GET /v1/cdp/profile-templates/:id", () => {
  const url = `/v1/cdp/profile-templates/${TPL_ID}`;

  it("200 — returns the template", async () => {
    H.findByIdMock.mockResolvedValue(makeTemplate());
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.vertical).toBe("retail");
    await app.close();
  });

  it("404 — unknown template", async () => {
    H.findByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: auth() });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("400 — id is not a uuid", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/cdp/profile-templates/not-a-uuid", headers: auth() });
    expect(r.statusCode).toBe(400);
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

describe("POST /v1/cdp/profile-templates", () => {
  const url = "/v1/cdp/profile-templates";
  const payload = {
    vertical: "retail",
    label: "Retail individual",
    attributes: [{ name: "email", type: "string", required: true, pii: true }],
    conflictRules: { email: { strategy: "highest_source_priority", sourcePriority: ["crm"] } },
    defaultStrategy: "most_recent",
    sourcePriority: ["crm", "web"],
  };

  it("202 — publishes template create command", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload });
    expect(r.statusCode).toBe(202);
    expect(r.json().data.status).toBe("accepted");
    expect(H.insertMock).not.toHaveBeenCalled();
    expect(H.enqueueMock).not.toHaveBeenCalled();
    expect(H.publishMock).toHaveBeenCalled();
    await app.close();
  });

  it("400 — vertical is not lower kebab/snake case", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: { ...payload, vertical: "Retail" } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — attribute spec is invalid", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url, headers: auth(),
      payload: { ...payload, attributes: [{ name: "email", type: "uuid" }], conflictRules: {} },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("INVALID_ATTRIBUTE_SPEC");
    await app.close();
  });

  it("400 — conflict rule names an undeclared attribute", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url, headers: auth(),
      payload: { ...payload, conflictRules: { ghost: { strategy: "most_recent" } } },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("INVALID_CONFLICT_RULES");
    await app.close();
  });

  it("400 — unknown default strategy", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url, headers: auth(), payload: { ...payload, defaultStrategy: "coin_flip" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("409 — a template already exists for the vertical", async () => {
    H.findByVerticalMock.mockResolvedValue(makeTemplate());
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload });
    expect(r.statusCode).toBe(409);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, payload });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — a plain cdp user cannot define templates", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(["cdp_user"]), payload });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("PATCH /v1/cdp/profile-templates/:id", () => {
  const url = `/v1/cdp/profile-templates/${TPL_ID}`;

  it("202 — publishes template update", async () => {
    H.findByIdMock.mockResolvedValue(makeTemplate());
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url, headers: auth(),
      payload: { label: "Retail (v2)", conflictRules: { email: { strategy: "most_recent" } }, version: 1 },
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().data.status).toBe("accepted");
    expect(H.publishMock).toHaveBeenCalled();
    await app.close();
  });

  it("400 — patched rules would orphan against the stored attributes", async () => {
    H.findByIdMock.mockResolvedValue(makeTemplate());
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url, headers: auth(),
      payload: { conflictRules: { ghost: { strategy: "most_recent" } }, version: 1 },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("INVALID_CONFLICT_RULES");
    await app.close();
  });

  it("400 — patched attributes would orphan the stored rules", async () => {
    H.findByIdMock.mockResolvedValue(makeTemplate());
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url, headers: auth(),
      // Stored rules reference `phone`, which this attribute list drops.
      payload: { attributes: [{ name: "email", type: "string" }], version: 1 },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — version is required", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url, headers: auth(), payload: { label: "x" } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("404 — unknown template", async () => {
    H.findByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url, headers: auth(), payload: { version: 1 } });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("202 — version conflicts deferred to consumer", async () => {
    H.findByIdMock.mockResolvedValue(makeTemplate());
    H.updateMock.mockResolvedValue(false);
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url, headers: auth(), payload: { label: "x", version: 1 } });
    expect(r.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalled();
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

describe("POST /v1/cdp/profile-templates/:id/resolve", () => {
  const url = `/v1/cdp/profile-templates/${TPL_ID}/resolve`;
  const payload = {
    candidates: [
      { attribute: "email", value: "new@example.gov.in", source: "web", observedAt: "2026-01-01T00:00:00.000Z" },
      { attribute: "email", value: "old@example.gov.in", source: "crm", observedAt: "2024-01-01T00:00:00.000Z" },
      { attribute: "phone", value: "9876543210", source: "crm", observedAt: "2020-01-01T00:00:00.000Z" },
      { attribute: "phone", value: "9000000000", source: "web", observedAt: "2026-01-01T00:00:00.000Z" },
    ],
  };

  it("200 — applies each attribute's rule and reports the decisions", async () => {
    H.findByIdMock.mockResolvedValue(makeTemplate());
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(["cdp_user"]), payload });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.attributes).toEqual({ email: "new@example.gov.in", phone: "9876543210" });
    expect(r.json().data.decisions).toHaveLength(2);
    expect(r.json().data.missingRequired).toEqual([]);
    await app.close();
  });

  it("200 — reports an unresolved required attribute without failing", async () => {
    H.findByIdMock.mockResolvedValue(makeTemplate());
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url, headers: auth(),
      payload: { candidates: [{ attribute: "phone", value: "9876543210", source: "crm", observedAt: "2026-01-01T00:00:00.000Z" }] },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.missingRequired).toEqual(["email"]);
    await app.close();
  });

  it("400 — candidates cannot be empty", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: { candidates: [] } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — observedAt must be a datetime", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url, headers: auth(),
      payload: { candidates: [{ attribute: "email", value: "a", source: "crm", observedAt: "yesterday" }] },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("404 — unknown template", async () => {
    H.findByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("422 — nothing supplied belongs to this vertical", async () => {
    H.findByIdMock.mockResolvedValue(makeTemplate());
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url, headers: auth(),
      payload: { candidates: [{ attribute: "zodiac", value: "leo", source: "crm", observedAt: "2026-01-01T00:00:00.000Z" }] },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("TEMPLATE_MISMATCH");
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, payload });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — role without cdp access", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(["viewer"]), payload });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("POST /v1/cdp/profiles/:id/apply-template", () => {
  const url = `/v1/cdp/profiles/${PROFILE_ID}/apply-template`;
  const payload = {
    templateId: TPL_ID,
    version: 1,
    candidates: [
      { attribute: "email", value: "new@example.gov.in", source: "web", observedAt: "2026-01-01T00:00:00.000Z" },
      { attribute: "phone", value: "9876543210", source: "crm", observedAt: "2026-01-01T00:00:00.000Z" },
      { attribute: "zodiac", value: "leo", source: "web", observedAt: "2026-01-01T00:00:00.000Z" },
    ],
  };

  it("202 — publishes apply-template command", async () => {
    H.profileFindByIdMock.mockResolvedValue(makeProfile());
    H.findByIdMock.mockResolvedValue(makeTemplate());
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload });
    expect(r.statusCode).toBe(202);
    expect(r.json().data.applied).toHaveLength(2);
    expect(r.json().data.ignoredAttributes).toEqual(["zodiac"]);
    expect(r.json().data.status).toBe("accepted");
    expect(H.profileUpdateMock).not.toHaveBeenCalled();
    expect(H.publishMock).toHaveBeenCalled();
    await app.close();
  });

  it("202 — route does not enqueue events directly", async () => {
    H.profileFindByIdMock.mockResolvedValue(makeProfile());
    H.findByIdMock.mockResolvedValue(makeTemplate());
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload });
    expect(r.statusCode).toBe(202);
    expect(H.enqueueMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("404 — unknown profile", async () => {
    H.profileFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("404 — a merged profile is not a target", async () => {
    H.profileFindByIdMock.mockResolvedValue(makeProfile({ profileType: "merged" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("404 — unknown template", async () => {
    H.profileFindByIdMock.mockResolvedValue(makeProfile());
    H.findByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("202 — version conflicts deferred to consumer", async () => {
    H.profileFindByIdMock.mockResolvedValue(makeProfile());
    H.findByIdMock.mockResolvedValue(makeTemplate());
    H.profileUpdateMock.mockResolvedValue(false);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload });
    expect(r.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalled();
    await app.close();
  });

  it("422 — a required attribute cannot be resolved", async () => {
    H.profileFindByIdMock.mockResolvedValue(makeProfile());
    H.findByIdMock.mockResolvedValue(makeTemplate());
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url, headers: auth(),
      payload: { ...payload, candidates: [{ attribute: "phone", value: "9876543210", source: "crm", observedAt: "2026-01-01T00:00:00.000Z" }] },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("REQUIRED_ATTRIBUTES_UNRESOLVED");
    expect(H.profileUpdateMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("400 — templateId must be a uuid", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: { ...payload, templateId: "x" } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, payload });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — a plain cdp user cannot rewrite golden attributes", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(["cdp_user"]), payload });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
