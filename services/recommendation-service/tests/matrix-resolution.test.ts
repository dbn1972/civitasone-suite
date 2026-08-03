/**
 * XS-001 — configurable cross-sell matrix: per-cell weight, effective dating and
 * companion resolution. Domain tests are table-driven with the boundary cases
 * (exact-instant bounds, open bounds, zero-length windows) called out explicitly.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import {
  MAX_WEIGHT_BPS,
  isEffectiveAt,
  resolveCompanions,
  validateEffectiveWindow,
  validateWeightBps,
  type MatrixCell,
} from "../src/modules/matrix/domain.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const HELD_A = "11111111-1111-4111-8111-111111111111";
const HELD_B = "22222222-2222-4222-8222-222222222222";
const COMP_X = "33333333-3333-4333-8333-333333333333";
const COMP_Y = "44444444-4444-4444-8444-444444444444";
const MATRIX_ID = "55555555-5555-4555-8555-555555555555";

const H = vi.hoisted(() => ({
  dbTransactionMock: vi.fn(),
  enqueueMock: vi.fn(),
  cacheGetOrLoadMock: vi.fn(),
  cacheInvalidateMock: vi.fn(),
  cacheMakeKeyMock: vi.fn(),
  queuePublishMock: vi.fn(),
  findByIdMock: vi.fn(),
  listByTenantMock: vi.fn(),
  findByProductPairMock: vi.fn(),
  listEffectiveForTriggersMock: vi.fn(),
  insertMock: vi.fn(),
  updateMock: vi.fn(),
  deleteByIdMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => H.dbTransactionMock(cb) },
  scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  sqlClient: { end: async () => {} },
}));

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: (...a: unknown[]) => H.enqueueMock(...a),
  markProcessed: async () => true,
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: (...a: unknown[]) => H.cacheGetOrLoadMock(...a),
    invalidate: (...a: unknown[]) => H.cacheInvalidateMock(...a),
    makeKey: (...a: unknown[]) => H.cacheMakeKeyMock(...a),
  },
  queue: { publish: (...a: unknown[]) => H.queuePublishMock(...a) },
}));

vi.mock("../src/modules/matrix/repo.js", async () => {
  const actual = await import("../src/modules/matrix/repo.js");
  return {
    toView: actual.toView,
    findById: (...a: unknown[]) => H.findByIdMock(...a),
    listByTenant: (...a: unknown[]) => H.listByTenantMock(...a),
    findByProductPair: (...a: unknown[]) => H.findByProductPairMock(...a),
    listEffectiveForTriggers: (...a: unknown[]) => H.listEffectiveForTriggersMock(...a),
    insert: (...a: unknown[]) => H.insertMock(...a),
    update: (...a: unknown[]) => H.updateMock(...a),
    deleteById: (...a: unknown[]) => H.deleteByIdMock(...a),
  };
});

import { buildApp } from "../src/app.js";

const tok = (roles: string[]) => signToken({ sub: USER, tid: TENANT, roles, sid: "sess-1" }, SECRET);
const auth = (roles = ["recommendation_admin"]) => ({ authorization: `Bearer ${tok(roles)}` });
const readerAuth = () => auth(["crm_user"]);
const strangerAuth = () => auth(["viewer"]);

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: MATRIX_ID,
    tenantId: TENANT,
    triggerProductId: HELD_A,
    recommendedProductId: COMP_X,
    segment: null,
    channel: null,
    priority: 10,
    weightBps: 5000,
    effectiveFrom: null,
    effectiveTo: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    createdBy: USER,
    updatedBy: USER,
    version: 1,
    ...overrides,
  };
}

function cell(overrides: Partial<MatrixCell> = {}): MatrixCell {
  return {
    id: "cell-1",
    triggerProductId: HELD_A,
    recommendedProductId: COMP_X,
    priority: 0,
    weightBps: 0,
    ...overrides,
  };
}

beforeEach(() => {
  H.queuePublishMock.mockReset();
  H.queuePublishMock.mockResolvedValue(undefined);
  vi.clearAllMocks();
  H.dbTransactionMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb({}));
  H.cacheMakeKeyMock.mockReturnValue("cache-key");
  H.cacheInvalidateMock.mockResolvedValue(undefined);
  H.enqueueMock.mockResolvedValue(undefined);
  H.queuePublishMock.mockResolvedValue("msg-1");
  H.listByTenantMock.mockResolvedValue({ rows: [], total: 0 });
  H.findByProductPairMock.mockResolvedValue([]);
  H.listEffectiveForTriggersMock.mockResolvedValue([]);
  H.insertMock.mockResolvedValue(undefined);
  H.updateMock.mockResolvedValue(true);
  H.deleteByIdMock.mockResolvedValue(true);
});

// ── isEffectiveAt: table-driven, boundaries explicit ──────────────────────────

describe("isEffectiveAt", () => {
  const T0 = "2026-06-01T00:00:00.000Z";
  const T1 = "2026-06-10T00:00:00.000Z";
  const T2 = "2026-06-20T00:00:00.000Z";

  const cases: {
    name: string;
    from: string | null;
    to: string | null;
    at: string;
    expected: boolean;
  }[] = [
    { name: "both bounds open — always live", from: null, to: null, at: T1, expected: true },
    { name: "at exactly effectiveFrom — INCLUSIVE, live", from: T1, to: null, at: T1, expected: true },
    { name: "one ms before effectiveFrom — not live", from: T1, to: null, at: "2026-06-09T23:59:59.999Z", expected: false },
    { name: "after effectiveFrom, no upper bound — live", from: T0, to: null, at: T1, expected: true },
    { name: "at exactly effectiveTo — EXCLUSIVE, expired", from: null, to: T1, at: T1, expected: false },
    { name: "one ms before effectiveTo — live", from: null, to: T1, at: "2026-06-09T23:59:59.999Z", expected: true },
    { name: "inside a closed window — live", from: T0, to: T2, at: T1, expected: true },
    { name: "before a closed window — not live", from: T1, to: T2, at: T0, expected: false },
    { name: "after a closed window — expired", from: T0, to: T1, at: T2, expected: false },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(isEffectiveAt({ effectiveFrom: c.from, effectiveTo: c.to }, new Date(c.at))).toBe(
        c.expected,
      );
    });
  }

  it("accepts Date bounds as well as ISO strings", () => {
    expect(
      isEffectiveAt({ effectiveFrom: new Date(T0), effectiveTo: new Date(T2) }, new Date(T1)),
    ).toBe(true);
  });

  it("treats undefined bounds as open", () => {
    expect(isEffectiveAt({}, new Date(T1))).toBe(true);
  });

  it("fails closed on an unparseable effectiveFrom", () => {
    expect(isEffectiveAt({ effectiveFrom: "not-a-date" }, new Date(T1))).toBe(false);
  });

  it("fails closed on an unparseable effectiveTo", () => {
    expect(isEffectiveAt({ effectiveTo: "not-a-date" }, new Date(T1))).toBe(false);
  });

  it("fails closed on an invalid asOf", () => {
    expect(isEffectiveAt({}, new Date("nope"))).toBe(false);
  });

  it("half-open windows tile with no gap and no overlap", () => {
    const boundary = new Date(T1);
    const first = { effectiveFrom: T0, effectiveTo: T1 };
    const second = { effectiveFrom: T1, effectiveTo: T2 };
    // Exactly one of the two is live at the shared boundary.
    expect([isEffectiveAt(first, boundary), isEffectiveAt(second, boundary)]).toEqual([false, true]);
  });
});

// ── validateEffectiveWindow ──────────────────────────────────────────────────

describe("validateEffectiveWindow", () => {
  it("accepts both bounds open", () => {
    expect(validateEffectiveWindow({})).toBeNull();
  });

  it("accepts only a lower bound", () => {
    expect(validateEffectiveWindow({ effectiveFrom: "2026-01-01T00:00:00.000Z" })).toBeNull();
  });

  it("accepts only an upper bound", () => {
    expect(validateEffectiveWindow({ effectiveTo: "2026-01-01T00:00:00.000Z" })).toBeNull();
  });

  it("accepts a positive-length window", () => {
    expect(
      validateEffectiveWindow({
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        effectiveTo: "2026-01-02T00:00:00.000Z",
      }),
    ).toBeNull();
  });

  it("rejects an inverted window", () => {
    expect(
      validateEffectiveWindow({
        effectiveFrom: "2026-01-02T00:00:00.000Z",
        effectiveTo: "2026-01-01T00:00:00.000Z",
      }),
    ).toContain("must be after");
  });

  it("rejects a zero-length window — it could never be live", () => {
    const at = "2026-01-01T00:00:00.000Z";
    expect(validateEffectiveWindow({ effectiveFrom: at, effectiveTo: at })).toContain("must be after");
  });

  it("rejects an unparseable lower bound", () => {
    expect(validateEffectiveWindow({ effectiveFrom: "soon" })).toContain("effectiveFrom");
  });

  it("rejects an unparseable upper bound", () => {
    expect(validateEffectiveWindow({ effectiveTo: "later" })).toContain("effectiveTo");
  });

  it("accepts null bounds explicitly", () => {
    expect(validateEffectiveWindow({ effectiveFrom: null, effectiveTo: null })).toBeNull();
  });
});

// ── validateWeightBps ────────────────────────────────────────────────────────

describe("validateWeightBps", () => {
  const cases: { value: number; valid: boolean; note: string }[] = [
    { value: 0, valid: true, note: "lower boundary" },
    { value: 1, valid: true, note: "just inside" },
    { value: MAX_WEIGHT_BPS, valid: true, note: "upper boundary = 100%" },
    { value: MAX_WEIGHT_BPS + 1, valid: false, note: "just over 100%" },
    { value: -1, valid: false, note: "negative" },
    { value: 12.5, valid: false, note: "fractional bps is meaningless" },
    { value: Number.NaN, valid: false, note: "NaN" },
    { value: Number.POSITIVE_INFINITY, valid: false, note: "infinite" },
  ];

  for (const c of cases) {
    it(`${c.valid ? "accepts" : "rejects"} ${c.value} (${c.note})`, () => {
      const result = validateWeightBps(c.value);
      if (c.valid) expect(result).toBeNull();
      else expect(result).not.toBeNull();
    });
  }

  it("MAX_WEIGHT_BPS is 10000 so bps means what it says", () => {
    expect(MAX_WEIGHT_BPS).toBe(10_000);
  });
});

// ── resolveCompanions ────────────────────────────────────────────────────────

describe("resolveCompanions", () => {
  const asOf = new Date("2026-06-10T00:00:00.000Z");

  it("returns nothing when there are no cells", () => {
    expect(resolveCompanions({ heldProductIds: [HELD_A], cells: [], asOf })).toEqual([]);
  });

  it("returns nothing when nothing is held", () => {
    expect(resolveCompanions({ heldProductIds: [], cells: [cell()], asOf })).toEqual([]);
  });

  it("fires a cell whose trigger product is held", () => {
    const result = resolveCompanions({ heldProductIds: [HELD_A], cells: [cell()], asOf });
    expect(result).toHaveLength(1);
    expect(result[0]?.recommendedProductId).toBe(COMP_X);
    expect(result[0]?.triggerProductIds).toEqual([HELD_A]);
  });

  it("ignores a cell whose trigger product is not held", () => {
    const result = resolveCompanions({
      heldProductIds: [HELD_B],
      cells: [cell({ triggerProductId: HELD_A })],
      asOf,
    });
    expect(result).toEqual([]);
  });

  it("ignores a cell outside its effective window", () => {
    const result = resolveCompanions({
      heldProductIds: [HELD_A],
      cells: [cell({ effectiveTo: "2026-06-01T00:00:00.000Z" })],
      asOf,
    });
    expect(result).toEqual([]);
  });

  it("includes a cell live exactly at its effectiveFrom", () => {
    const result = resolveCompanions({
      heldProductIds: [HELD_A],
      cells: [cell({ effectiveFrom: asOf.toISOString() })],
      asOf,
    });
    expect(result).toHaveLength(1);
  });

  it("excludes a cell expiring exactly at asOf", () => {
    const result = resolveCompanions({
      heldProductIds: [HELD_A],
      cells: [cell({ effectiveTo: asOf.toISOString() })],
      asOf,
    });
    expect(result).toEqual([]);
  });

  it("suppresses a companion the customer already holds by default", () => {
    const result = resolveCompanions({
      heldProductIds: [HELD_A, COMP_X],
      cells: [cell()],
      asOf,
    });
    expect(result).toEqual([]);
  });

  it("keeps a held companion when excludeHeld is false", () => {
    const result = resolveCompanions({
      heldProductIds: [HELD_A, COMP_X],
      cells: [cell()],
      asOf,
      excludeHeld: false,
    });
    expect(result).toHaveLength(1);
  });

  it("collapses two cells recommending the same companion, taking the MAX priority", () => {
    const result = resolveCompanions({
      heldProductIds: [HELD_A, HELD_B],
      cells: [
        cell({ id: "c1", triggerProductId: HELD_A, priority: 5, weightBps: 1000 }),
        cell({ id: "c2", triggerProductId: HELD_B, priority: 9, weightBps: 400 }),
      ],
      asOf,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.priority).toBe(9);
  });

  it("collapses to the MAX weight, never a sum — extra rows must not inflate rank", () => {
    const result = resolveCompanions({
      heldProductIds: [HELD_A, HELD_B],
      cells: [
        cell({ id: "c1", triggerProductId: HELD_A, weightBps: 3000 }),
        cell({ id: "c2", triggerProductId: HELD_B, weightBps: 4000 }),
      ],
      asOf,
    });
    expect(result[0]?.weightBps).toBe(4000);
  });

  it("records every contributing trigger and cell, sorted", () => {
    const result = resolveCompanions({
      heldProductIds: [HELD_B, HELD_A],
      cells: [
        cell({ id: "c2", triggerProductId: HELD_B }),
        cell({ id: "c1", triggerProductId: HELD_A }),
      ],
      asOf,
    });
    expect(result[0]?.cellIds).toEqual(["c1", "c2"]);
    expect(result[0]?.triggerProductIds).toEqual([HELD_A, HELD_B].sort());
  });

  it("does not duplicate a trigger when two cells share it", () => {
    const result = resolveCompanions({
      heldProductIds: [HELD_A],
      cells: [
        cell({ id: "c1", triggerProductId: HELD_A, segment: "retail" }),
        cell({ id: "c2", triggerProductId: HELD_A, segment: "sme" }),
      ],
      asOf,
    });
    expect(result[0]?.triggerProductIds).toEqual([HELD_A]);
    expect(result[0]?.cellIds).toEqual(["c1", "c2"]);
  });

  it("orders by priority DESC, then weight DESC, then product id ASC", () => {
    const result = resolveCompanions({
      heldProductIds: [HELD_A],
      cells: [
        cell({ id: "low", recommendedProductId: COMP_Y, priority: 1, weightBps: 9999 }),
        cell({ id: "high", recommendedProductId: COMP_X, priority: 5, weightBps: 1 }),
      ],
      asOf,
    });
    expect(result.map((r) => r.recommendedProductId)).toEqual([COMP_X, COMP_Y]);
  });

  it("breaks a full tie on product id, so the order is total", () => {
    const result = resolveCompanions({
      heldProductIds: [HELD_A],
      cells: [
        cell({ id: "b", recommendedProductId: COMP_Y, priority: 3, weightBps: 100 }),
        cell({ id: "a", recommendedProductId: COMP_X, priority: 3, weightBps: 100 }),
      ],
      asOf,
    });
    expect(result.map((r) => r.recommendedProductId)).toEqual([COMP_X, COMP_Y]);
  });

  it("is order-independent: shuffling the input does not change the output", () => {
    const cells = [
      cell({ id: "a", recommendedProductId: COMP_X, priority: 2, weightBps: 50 }),
      cell({ id: "b", recommendedProductId: COMP_Y, priority: 2, weightBps: 50 }),
    ];
    const forward = resolveCompanions({ heldProductIds: [HELD_A], cells, asOf });
    const reversed = resolveCompanions({ heldProductIds: [HELD_A], cells: [...cells].reverse(), asOf });
    expect(reversed).toEqual(forward);
  });

  it("does not mutate the input cells array", () => {
    const cells = [cell({ id: "a" }), cell({ id: "b", recommendedProductId: COMP_Y })];
    const snapshot = JSON.stringify(cells);
    resolveCompanions({ heldProductIds: [HELD_A], cells, asOf });
    expect(JSON.stringify(cells)).toBe(snapshot);
  });
});

// ── POST /v1/recommendations/matrix (weight + dating) ─────────────────────────

describe("POST /v1/recommendations/matrix — XS-001 fields", () => {
  const url = "/v1/recommendations/matrix";

  it("202 — persists weightBps and the effective window", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: auth(),
      payload: {
        triggerProductId: HELD_A,
        recommendedProductId: COMP_X,
        priority: 7,
        weightBps: 2500,
        effectiveFrom: "2026-06-01T00:00:00.000Z",
        effectiveTo: "2026-07-01T00:00:00.000Z",
      },
    });
    expect(r.statusCode).toBe(202);
    const written = (H.queuePublishMock.mock.calls[0]?.[1] as any).payload as { weightBps: number; effectiveFrom: Date };
    expect(written.weightBps).toBe(2500);
    expect(written.effectiveFrom).toBe("2026-06-01T00:00:00.000Z");
    await app.close();
  });

  it("202 — defaults weightBps to 0 and both bounds to null", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: auth(),
      payload: { triggerProductId: HELD_A, recommendedProductId: COMP_X },
    });
    expect(r.statusCode).toBe(202);
    await app.close();
  });

  it("202 — the created event carries the new fields", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url,
      headers: auth(),
      payload: { triggerProductId: HELD_A, recommendedProductId: COMP_X, weightBps: 100 },
    });
    const event = H.queuePublishMock.mock.calls[0]?.[1] as { payload: Record<string, unknown> };
    expect(event.payload.weightBps).toBe(100);
    await app.close();
  });

  it("400 — weightBps above 10000", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: auth(),
      payload: { triggerProductId: HELD_A, recommendedProductId: COMP_X, weightBps: 10_001 },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — weightBps is fractional", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: auth(),
      payload: { triggerProductId: HELD_A, recommendedProductId: COMP_X, weightBps: 1.5 },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — effectiveFrom is not a timestamp", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: auth(),
      payload: { triggerProductId: HELD_A, recommendedProductId: COMP_X, effectiveFrom: "june" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("422 — inverted effective window", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: auth(),
      payload: {
        triggerProductId: HELD_A,
        recommendedProductId: COMP_X,
        effectiveFrom: "2026-07-01T00:00:00.000Z",
        effectiveTo: "2026-06-01T00:00:00.000Z",
      },
    });
    expect(r.statusCode).toBe(422);
    // The platform error envelope from @civitasone/schemas is flat:
    // { code, message, correlationId, retryable }.
    expect(r.json().code).toBe("MATRIX_INVALID");
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      payload: { triggerProductId: HELD_A, recommendedProductId: COMP_X },
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — a reader cannot create configuration", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: readerAuth(),
      payload: { triggerProductId: HELD_A, recommendedProductId: COMP_X },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ── PATCH /v1/recommendations/matrix/:id (weight + dating) ────────────────────

describe("PATCH /v1/recommendations/matrix/:id — XS-001 fields", () => {
  const url = `/v1/recommendations/matrix/${MATRIX_ID}`;

  it("202 — accepts weightBps update", async () => {
    H.findByIdMock.mockResolvedValue(makeRow());
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url,
      headers: auth(),
      payload: { weightBps: 750, version: 1 },
    });
    expect(r.statusCode).toBe(202);
    const patch = (H.queuePublishMock.mock.calls.at(-1)?.[1] as { payload: { patch: any } }).payload.patch as { weightBps: number };
    expect(patch.weightBps).toBe(750);
    await app.close();
  });

  it("202 — accepts clearing effective bound", async () => {
    H.findByIdMock.mockResolvedValue(makeRow({ effectiveTo: new Date("2026-07-01T00:00:00.000Z") }));
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url,
      headers: auth(),
      payload: { effectiveTo: null, version: 1 },
    });
    expect(r.statusCode).toBe(202);
    const patch = (H.queuePublishMock.mock.calls.at(-1)?.[1] as { payload: { patch: any } }).payload.patch as { effectiveTo: Date | null };
    expect(patch.effectiveTo).toBeNull();
    await app.close();
  });

  it("422 — patching only effectiveTo is validated against the STORED effectiveFrom", async () => {
    H.findByIdMock.mockResolvedValue(makeRow({ effectiveFrom: new Date("2026-07-01T00:00:00.000Z") }));
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url,
      headers: auth(),
      payload: { effectiveTo: "2026-06-01T00:00:00.000Z", version: 1 },
    });
    expect(r.statusCode).toBe(422);
    await app.close();
  });

  it("404 — unknown id", async () => {
    H.findByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url,
      headers: auth(),
      payload: { weightBps: 1, version: 1 },
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("400 — weightBps out of range", async () => {
    H.findByIdMock.mockResolvedValue(makeRow());
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url,
      headers: auth(),
      payload: { weightBps: -5, version: 1 },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url, payload: { weightBps: 1, version: 1 } });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — a reader cannot patch configuration", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url,
      headers: readerAuth(),
      payload: { weightBps: 1, version: 1 },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ── GET /v1/recommendations/matrix/:id — view shape ───────────────────────────

describe("GET /v1/recommendations/matrix/:id — XS-001 view", () => {
  const url = `/v1/recommendations/matrix/${MATRIX_ID}`;

  it("200 — exposes weightBps and both bounds", async () => {
    H.cacheGetOrLoadMock.mockResolvedValue(
      makeRow({
        weightBps: 1234,
        effectiveFrom: new Date("2026-06-01T00:00:00.000Z"),
        effectiveTo: new Date("2026-07-01T00:00:00.000Z"),
      }),
    );
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: readerAuth() });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("200 — tolerates ISO strings from a warm cache", async () => {
    H.cacheGetOrLoadMock.mockResolvedValue(
      makeRow({
        effectiveFrom: "2026-06-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: readerAuth() });
    expect(r.statusCode).toBe(200);
    await app.close();
  });
});

// ── POST /v1/recommendations/matrix/resolve ───────────────────────────────────

describe("POST /v1/recommendations/matrix/resolve", () => {
  const url = "/v1/recommendations/matrix/resolve";

  it("200 — resolves companions for the held products", async () => {
    H.listEffectiveForTriggersMock.mockResolvedValue([makeRow()]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: readerAuth(),
      payload: { heldProductIds: [HELD_A] },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    expect(r.json().data[0].recommendedProductId).toBe(COMP_X);
    expect(r.json().data[0].weightBps).toBe(5000);
    await app.close();
  });

  it("200 — empty result when nothing matches", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: readerAuth(),
      payload: { heldProductIds: [HELD_A] },
    });
    expect(r.json().data).toEqual([]);
    expect(r.json().meta.total).toBe(0);
    await app.close();
  });

  it("200 — passes asOf through to the query and echoes it", async () => {
    const app = await buildApp();
    const asOf = "2026-06-15T00:00:00.000Z";
    const r = await app.inject({
      method: "POST",
      url,
      headers: readerAuth(),
      payload: { heldProductIds: [HELD_A], asOf },
    });
    expect(r.json().meta.asOf).toBe(asOf);
    expect(H.listEffectiveForTriggersMock.mock.calls[0]?.[2]).toEqual(new Date(asOf));
    await app.close();
  });

  it("200 — defaults asOf to now when omitted", async () => {
    const before = Date.now();
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: readerAuth(),
      payload: { heldProductIds: [HELD_A] },
    });
    const echoed = new Date(r.json().meta.asOf).getTime();
    expect(echoed).toBeGreaterThanOrEqual(before);
    await app.close();
  });

  it("200 — forwards segment and channel filters", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url,
      headers: readerAuth(),
      payload: { heldProductIds: [HELD_A], segment: "retail", channel: "web" },
    });
    expect(H.listEffectiveForTriggersMock.mock.calls[0]?.[4]).toEqual({
      segment: "retail",
      channel: "web",
    });
    await app.close();
  });

  it("200 — suppresses a companion already held", async () => {
    H.listEffectiveForTriggersMock.mockResolvedValue([makeRow()]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: readerAuth(),
      payload: { heldProductIds: [HELD_A, COMP_X] },
    });
    expect(r.json().data).toEqual([]);
    await app.close();
  });

  it("200 — excludeHeld=false keeps a held companion", async () => {
    H.listEffectiveForTriggersMock.mockResolvedValue([makeRow()]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: readerAuth(),
      payload: { heldProductIds: [HELD_A, COMP_X], excludeHeld: false },
    });
    expect(r.json().data).toHaveLength(1);
    await app.close();
  });

  it("200 — respects limit while reporting the full total", async () => {
    H.listEffectiveForTriggersMock.mockResolvedValue([
      makeRow({ id: "c1", recommendedProductId: COMP_X, priority: 5 }),
      makeRow({ id: "c2", recommendedProductId: COMP_Y, priority: 4 }),
    ]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: readerAuth(),
      payload: { heldProductIds: [HELD_A], limit: 1 },
    });
    expect(r.json().data).toHaveLength(1);
    expect(r.json().meta.total).toBe(2);
    await app.close();
  });

  it("400 — heldProductIds is empty", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: readerAuth(),
      payload: { heldProductIds: [] },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — a held product id is not a uuid", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: readerAuth(),
      payload: { heldProductIds: ["nope"] },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — limit above the maximum", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: readerAuth(),
      payload: { heldProductIds: [HELD_A], limit: 500 },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, payload: { heldProductIds: [HELD_A] } });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: strangerAuth(),
      payload: { heldProductIds: [HELD_A] },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
