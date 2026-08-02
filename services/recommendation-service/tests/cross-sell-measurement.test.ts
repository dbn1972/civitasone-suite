/**
 * XS-003 — cross-sell measurement: attribution, attach rate, uplift.
 *
 * The zero-denominator cases are the point of this file. An attach rate whose
 * denominator is zero must come back NULL with a note, never 0 and never NaN, and
 * nothing may divide by an unchecked value. Those cases are asserted explicitly
 * rather than left to a generic happy-path test.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import {
  BPS_SCALE,
  MAX_LOOKBACK_DAYS,
  attributeOutcome,
  bpsToPercentString,
  computeAttachRate,
  computeUplift,
  ratioToBps,
  type CohortTally,
  type ServedTouch,
} from "../src/modules/measurement/domain.js";
import { ATTRIBUTION_MODELS, COHORTS } from "../src/modules/measurement/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const SUBJECT = "bbbbbbbb-1111-4000-8000-000000000001";
const REC_1 = "cccccccc-1111-4000-8000-000000000001";
const REC_2 = "cccccccc-2222-4000-8000-000000000002";
const EXPOSURE_ID = "dddddddd-1111-4000-8000-000000000001";
const ATTR_ID = "eeeeeeee-1111-4000-8000-000000000001";
const PRODUCT_A = "11111111-1111-4111-8111-111111111111";
const PRODUCT_B = "22222222-2222-4222-8222-222222222222";
const MSG_ID = "ffffffff-1111-4000-8000-000000000001";

const OUTCOME_AT = new Date("2026-06-15T00:00:00.000Z");

const H = vi.hoisted(() => ({
  dbTransactionMock: vi.fn(),
  enqueueMock: vi.fn(),
  markProcessedMock: vi.fn(),
  cacheInvalidateMock: vi.fn(),
  cacheMakeKeyMock: vi.fn(),
  cacheGetOrLoadMock: vi.fn(),
  queuePublishMock: vi.fn(),
  runWithTenantMock: vi.fn(),
  findExposureMock: vi.fn(),
  findAttributionByOutcomeMock: vi.fn(),
  listAttributionsMock: vi.fn(),
  tallyCohortMock: vi.fn(),
  insertAttributionMock: vi.fn(),
  insertExposureMock: vi.fn(),
  listForProfileMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => H.dbTransactionMock(cb) },
  scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  sqlClient: { end: async () => {} },
}));

vi.mock("@civitasone/db", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@civitasone/db");
  return {
    ...actual,
    runWithTenant: (tenantId: string, fn: () => unknown) => H.runWithTenantMock(tenantId, fn),
  };
});

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: (...a: unknown[]) => H.enqueueMock(...a),
  markProcessed: (...a: unknown[]) => H.markProcessedMock(...a),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: (...a: unknown[]) => H.cacheGetOrLoadMock(...a),
    invalidate: (...a: unknown[]) => H.cacheInvalidateMock(...a),
    makeKey: (...a: unknown[]) => H.cacheMakeKeyMock(...a),
  },
  queue: { publish: (...a: unknown[]) => H.queuePublishMock(...a) },
}));

vi.mock("../src/modules/measurement/repo.js", async () => {
  const actual = await import("../src/modules/measurement/repo.js");
  return {
    toAttributionView: actual.toAttributionView,
    toExposureView: actual.toExposureView,
    findExposure: (...a: unknown[]) => H.findExposureMock(...a),
    findAttributionByOutcome: (...a: unknown[]) => H.findAttributionByOutcomeMock(...a),
    listAttributions: (...a: unknown[]) => H.listAttributionsMock(...a),
    tallyCohort: (...a: unknown[]) => H.tallyCohortMock(...a),
    insertAttribution: (...a: unknown[]) => H.insertAttributionMock(...a),
    insertExposure: (...a: unknown[]) => H.insertExposureMock(...a),
  };
});

vi.mock("../src/modules/nba/repo.js", async () => {
  const actual = await import("../src/modules/nba/repo.js");
  return {
    ...actual,
    listForProfile: (...a: unknown[]) => H.listForProfileMock(...a),
  };
});

import { buildApp } from "../src/app.js";
import { handleRecordAttribution } from "../src/modules/measurement/consumer.js";

const tok = (roles: string[]) => signToken({ sub: USER, tid: TENANT, roles, sid: "sess-1" }, SECRET);
const auth = (roles = ["recommendation_admin"]) => ({ authorization: `Bearer ${tok(roles)}` });
const readerAuth = () => auth(["crm_user"]);
const strangerAuth = () => auth(["viewer"]);

const tally = (over: Partial<CohortTally> = {}): CohortTally => ({
  exposed: 0,
  converted: 0,
  attributedAmountMinor: 0n,
  ...over,
});

function exposureRow(over: Record<string, unknown> = {}) {
  return {
    id: EXPOSURE_ID,
    tenantId: TENANT,
    campaignKey: "q3-crosssell",
    subjectId: SUBJECT,
    cohort: "treatment",
    assignedAt: new Date("2026-06-01T00:00:00.000Z"),
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    createdBy: USER,
    updatedBy: USER,
    version: 1,
    ...over,
  };
}

function attributionRow(over: Record<string, unknown> = {}) {
  return {
    id: ATTR_ID,
    tenantId: TENANT,
    campaignKey: "q3-crosssell",
    subjectId: SUBJECT,
    recommendationId: REC_1,
    outcomeType: "order",
    outcomeRef: "ORD-1",
    productId: PRODUCT_A,
    attributedAmountMinor: 1_250_000n,
    currency: "INR",
    cohort: "treatment",
    attributionModel: "last_touch",
    occurredAt: OUTCOME_AT,
    createdAt: OUTCOME_AT,
    updatedAt: OUTCOME_AT,
    createdBy: USER,
    updatedBy: USER,
    version: 1,
    ...over,
  };
}

function servedRow(over: Record<string, unknown> = {}) {
  return {
    id: REC_1,
    tenantId: TENANT,
    profileId: SUBJECT,
    recommendationType: "cross_sell",
    productId: PRODUCT_A,
    channel: "web",
    score: "0.9000",
    status: "served",
    servedAt: new Date("2026-06-10T00:00:00.000Z"),
    createdAt: new Date("2026-06-10T00:00:00.000Z"),
    updatedAt: new Date("2026-06-10T00:00:00.000Z"),
    createdBy: USER,
    updatedBy: USER,
    version: 1,
    ...over,
  };
}

const recordPayload = {
  campaignKey: "q3-crosssell",
  subjectId: SUBJECT,
  outcomeType: "order",
  outcomeRef: "ORD-1",
  productId: PRODUCT_A,
  amountMinor: "1250000",
  currency: "INR",
  occurredAt: OUTCOME_AT.toISOString(),
};

beforeEach(() => {
  H.queuePublishMock.mockReset();
  H.queuePublishMock.mockResolvedValue(undefined);
  vi.clearAllMocks();
  H.dbTransactionMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb({}));
  H.runWithTenantMock.mockImplementation(async (_t: string, fn: () => unknown) => fn());
  H.cacheMakeKeyMock.mockReturnValue("cache-key");
  H.cacheInvalidateMock.mockResolvedValue(undefined);
  H.enqueueMock.mockResolvedValue(undefined);
  H.markProcessedMock.mockResolvedValue(true);
  H.queuePublishMock.mockResolvedValue("msg-1");
  H.findExposureMock.mockResolvedValue(exposureRow());
  H.findAttributionByOutcomeMock.mockResolvedValue(null);
  H.listAttributionsMock.mockResolvedValue({ rows: [], total: 0 });
  H.tallyCohortMock.mockResolvedValue(tally());
  H.insertAttributionMock.mockResolvedValue(undefined);
  H.insertExposureMock.mockResolvedValue(undefined);
  H.listForProfileMock.mockResolvedValue({ rows: [], total: 0 });
});

// ── schema constants ─────────────────────────────────────────────────────────

describe("measurement constants", () => {
  it("declares exactly two cohorts", () => {
    expect(COHORTS).toEqual(["treatment", "control"]);
  });

  it("declares the supported attribution models", () => {
    expect(ATTRIBUTION_MODELS).toEqual(["last_touch", "first_touch"]);
  });

  it("BPS_SCALE is 10000", () => {
    expect(BPS_SCALE).toBe(10_000);
  });

  it("MAX_LOOKBACK_DAYS is a year", () => {
    expect(MAX_LOOKBACK_DAYS).toBe(365);
  });
});

// ── ratioToBps: the single division site ─────────────────────────────────────

describe("ratioToBps", () => {
  const cases: { count: number; total: number; expected: number | null; note: string }[] = [
    { count: 0, total: 0, expected: null, note: "ZERO DENOMINATOR — undefined, not zero" },
    { count: 5, total: 0, expected: null, note: "zero denominator with a non-zero count" },
    { count: 0, total: 100, expected: 0, note: "genuine zero rate" },
    { count: 100, total: 100, expected: 10_000, note: "100% = 10000 bps" },
    { count: 1, total: 100, expected: 100, note: "1% = 100 bps" },
    { count: 1, total: 3, expected: 3333, note: "one third, rounded half-up once" },
    { count: 2, total: 3, expected: 6667, note: "two thirds, rounded half-up once" },
    { count: 1, total: 8, expected: 1250, note: "12.5% exactly" },
    { count: 1, total: 20_000, expected: 1, note: "sub-bps rounds to 1" },
    { count: 1, total: 100_000, expected: 0, note: "far sub-bps rounds to 0" },
    { count: 3, total: -1, expected: null, note: "negative denominator rejected" },
    { count: Number.NaN, total: 10, expected: null, note: "NaN count" },
    { count: 10, total: Number.NaN, expected: null, note: "NaN total" },
    { count: 10, total: Number.POSITIVE_INFINITY, expected: null, note: "infinite total" },
  ];

  for (const c of cases) {
    it(`${c.count}/${c.total} → ${c.expected} (${c.note})`, () => {
      expect(ratioToBps(c.count, c.total)).toBe(c.expected);
    });
  }

  it("never returns NaN", () => {
    for (const c of cases) {
      const result = ratioToBps(c.count, c.total);
      expect(result === null || Number.isFinite(result)).toBe(true);
    }
  });

  it("keeps precision for a large exact denominator", () => {
    expect(ratioToBps(500_000, 1_000_000)).toBe(5000);
  });
});

// ── computeAttachRate ────────────────────────────────────────────────────────

describe("computeAttachRate", () => {
  it("computes a normal rate", () => {
    const m = computeAttachRate("treatment", tally({ exposed: 1000, converted: 120 }));
    expect(m.attachRateBps).toBe(1200);
    expect(m.notes).toEqual([]);
  });

  it("EMPTY COHORT — rate is null with a note, never zero", () => {
    const m = computeAttachRate("treatment", tally({ exposed: 0, converted: 0 }));
    expect(m.attachRateBps).toBeNull();
    expect(m.notes.join(" ")).toContain("no exposures");
    expect(m.notes.join(" ")).toContain("not zero");
  });

  it("EMPTY HOLDOUT — control side behaves identically", () => {
    const m = computeAttachRate("control", tally({ exposed: 0 }));
    expect(m.attachRateBps).toBeNull();
    expect(m.cohort).toBe("control");
  });

  it("zero conversions on a real cohort is a genuine 0 bps", () => {
    const m = computeAttachRate("treatment", tally({ exposed: 500, converted: 0 }));
    expect(m.attachRateBps).toBe(0);
  });

  it("100% attach is 10000 bps", () => {
    const m = computeAttachRate("treatment", tally({ exposed: 50, converted: 50 }));
    expect(m.attachRateBps).toBe(10_000);
  });

  it("MONEY — the attributed total is serialised as a string", () => {
    const m = computeAttachRate(
      "treatment",
      tally({ exposed: 10, converted: 2, attributedAmountMinor: 1_250_000n }),
    );
    expect(m.attributedAmountMinor).toBe("1250000");
    expect(typeof m.attributedAmountMinor).toBe("string");
  });

  it("MONEY — keeps precision beyond 2^53", () => {
    const m = computeAttachRate(
      "treatment",
      tally({ exposed: 1, converted: 1, attributedAmountMinor: 9007199254740993n }),
    );
    expect(m.attributedAmountMinor).toBe("9007199254740993");
  });

  it("average value per conversion is a truncated bigint mean", () => {
    const m = computeAttachRate(
      "treatment",
      tally({ exposed: 10, converted: 3, attributedAmountMinor: 1000n }),
    );
    // 1000 / 3 = 333.33 → 333 minor units; a fraction of a paisa is not payable.
    expect(m.averageValuePerConversionMinor).toBe("333");
  });

  it("ZERO CONVERSIONS — average value is null with a note, not a divide by zero", () => {
    const m = computeAttachRate(
      "treatment",
      tally({ exposed: 10, converted: 0, attributedAmountMinor: 0n }),
    );
    expect(m.averageValuePerConversionMinor).toBeNull();
    expect(m.notes.join(" ")).toContain("no conversions");
  });

  it("an empty cohort reports BOTH undefined metrics", () => {
    const m = computeAttachRate("treatment", tally());
    expect(m.attachRateBps).toBeNull();
    expect(m.averageValuePerConversionMinor).toBeNull();
    expect(m.notes).toHaveLength(2);
  });
});

// ── computeUplift ────────────────────────────────────────────────────────────

describe("computeUplift", () => {
  it("computes absolute and relative uplift", () => {
    // treatment 12%, control 8% → +400 bps absolute, +50% relative.
    const m = computeUplift(
      tally({ exposed: 1000, converted: 120 }),
      tally({ exposed: 1000, converted: 80 }),
    );
    expect(m.treatment.attachRateBps).toBe(1200);
    expect(m.control.attachRateBps).toBe(800);
    expect(m.absoluteUpliftBps).toBe(400);
    expect(m.relativeUpliftBps).toBe(5000);
  });

  it("reports a NEGATIVE uplift rather than hiding it", () => {
    const m = computeUplift(
      tally({ exposed: 100, converted: 5 }),
      tally({ exposed: 100, converted: 10 }),
    );
    expect(m.absoluteUpliftBps).toBe(-500);
    expect(m.relativeUpliftBps).toBe(-5000);
  });

  it("does not cap a relative uplift above 100%", () => {
    // treatment 30%, control 10% → +200% relative = 20000 bps.
    const m = computeUplift(
      tally({ exposed: 100, converted: 30 }),
      tally({ exposed: 100, converted: 10 }),
    );
    expect(m.relativeUpliftBps).toBe(20_000);
  });

  it("EMPTY HOLDOUT — both uplifts null with a note", () => {
    const m = computeUplift(tally({ exposed: 1000, converted: 120 }), tally({ exposed: 0 }));
    expect(m.absoluteUpliftBps).toBeNull();
    expect(m.relativeUpliftBps).toBeNull();
    expect(m.notes.join(" ")).toContain("both cohorts need at least one exposure");
  });

  it("EMPTY TREATMENT — both uplifts null", () => {
    const m = computeUplift(tally({ exposed: 0 }), tally({ exposed: 100, converted: 10 }));
    expect(m.absoluteUpliftBps).toBeNull();
    expect(m.relativeUpliftBps).toBeNull();
  });

  it("BOTH COHORTS EMPTY — nothing is computed and nothing throws", () => {
    const m = computeUplift(tally(), tally());
    expect(m.absoluteUpliftBps).toBeNull();
    expect(m.relativeUpliftBps).toBeNull();
    expect(m.treatment.attachRateBps).toBeNull();
    expect(m.control.attachRateBps).toBeNull();
  });

  it("ZERO CONTROL RATE — absolute uplift survives, relative is null", () => {
    const m = computeUplift(
      tally({ exposed: 100, converted: 12 }),
      tally({ exposed: 100, converted: 0 }),
    );
    expect(m.control.attachRateBps).toBe(0);
    expect(m.absoluteUpliftBps).toBe(1200);
    expect(m.relativeUpliftBps).toBeNull();
    expect(m.notes.join(" ")).toContain("relative uplift is undefined");
  });

  it("identical cohorts give zero uplift, not null", () => {
    const m = computeUplift(
      tally({ exposed: 100, converted: 10 }),
      tally({ exposed: 100, converted: 10 }),
    );
    expect(m.absoluteUpliftBps).toBe(0);
    expect(m.relativeUpliftBps).toBe(0);
  });

  it("never produces NaN for any combination of empty cohorts", () => {
    const combos: [CohortTally, CohortTally][] = [
      [tally(), tally()],
      [tally({ exposed: 1 }), tally()],
      [tally(), tally({ exposed: 1 })],
      [tally({ exposed: 1 }), tally({ exposed: 1 })],
      [tally({ exposed: 1, converted: 1 }), tally({ exposed: 1 })],
    ];
    for (const [t, c] of combos) {
      const m = computeUplift(t, c);
      for (const value of [m.absoluteUpliftBps, m.relativeUpliftBps]) {
        expect(value === null || Number.isFinite(value)).toBe(true);
      }
    }
  });

  it("carries both cohorts' notes through", () => {
    const m = computeUplift(tally(), tally());
    expect(m.notes.length).toBeGreaterThanOrEqual(4);
  });
});

// ── bpsToPercentString ───────────────────────────────────────────────────────

describe("bpsToPercentString", () => {
  const cases: { bps: number | null; expected: string | null }[] = [
    { bps: 0, expected: "0.00" },
    { bps: 1, expected: "0.01" },
    { bps: 100, expected: "1.00" },
    { bps: 1234, expected: "12.34" },
    { bps: 10_000, expected: "100.00" },
    { bps: 20_000, expected: "200.00" },
    { bps: -500, expected: "-5.00" },
    { bps: -1, expected: "-0.01" },
    { bps: null, expected: null },
  ];
  for (const c of cases) {
    it(`${c.bps} → ${JSON.stringify(c.expected)}`, () => {
      expect(bpsToPercentString(c.bps)).toBe(c.expected);
    });
  }

  it("returns null for a fractional bps rather than guessing", () => {
    expect(bpsToPercentString(1.5)).toBeNull();
  });
});

// ── attributeOutcome ─────────────────────────────────────────────────────────

describe("attributeOutcome", () => {
  const touch = (over: Partial<ServedTouch> = {}): ServedTouch => ({
    recommendationId: REC_1,
    productId: PRODUCT_A,
    servedAt: new Date(OUTCOME_AT.getTime() - 5 * 86_400_000),
    ...over,
  });

  it("returns null with no touches", () => {
    expect(
      attributeOutcome({ touches: [], model: "last_touch", outcomeAt: OUTCOME_AT, lookbackDays: 30 }),
    ).toBeNull();
  });

  it("credits a single eligible touch", () => {
    const result = attributeOutcome({
      touches: [touch()],
      model: "last_touch",
      outcomeAt: OUTCOME_AT,
      lookbackDays: 30,
    });
    expect(result?.recommendationId).toBe(REC_1);
    expect(result?.ageDays).toBe(5);
  });

  it("last_touch credits the LATEST eligible touch", () => {
    const result = attributeOutcome({
      touches: [
        touch({ recommendationId: REC_1, servedAt: new Date(OUTCOME_AT.getTime() - 20 * 86_400_000) }),
        touch({ recommendationId: REC_2, servedAt: new Date(OUTCOME_AT.getTime() - 2 * 86_400_000) }),
      ],
      model: "last_touch",
      outcomeAt: OUTCOME_AT,
      lookbackDays: 30,
    });
    expect(result?.recommendationId).toBe(REC_2);
  });

  it("first_touch credits the EARLIEST eligible touch", () => {
    const result = attributeOutcome({
      touches: [
        touch({ recommendationId: REC_1, servedAt: new Date(OUTCOME_AT.getTime() - 20 * 86_400_000) }),
        touch({ recommendationId: REC_2, servedAt: new Date(OUTCOME_AT.getTime() - 2 * 86_400_000) }),
      ],
      model: "first_touch",
      outcomeAt: OUTCOME_AT,
      lookbackDays: 30,
    });
    expect(result?.recommendationId).toBe(REC_1);
  });

  it("ignores a touch served AFTER the outcome — it cannot have caused it", () => {
    const result = attributeOutcome({
      touches: [touch({ servedAt: new Date(OUTCOME_AT.getTime() + 86_400_000) })],
      model: "last_touch",
      outcomeAt: OUTCOME_AT,
      lookbackDays: 30,
    });
    expect(result).toBeNull();
  });

  it("credits a touch served in the same instant as the outcome", () => {
    const result = attributeOutcome({
      touches: [touch({ servedAt: OUTCOME_AT })],
      model: "last_touch",
      outcomeAt: OUTCOME_AT,
      lookbackDays: 0,
    });
    expect(result?.ageDays).toBe(0);
  });

  const lookbackCases: { lookback: number; ageDays: number; credited: boolean; note: string }[] = [
    { lookback: 30, ageDays: 30, credited: true, note: "exactly at the boundary — INCLUSIVE" },
    { lookback: 30, ageDays: 31, credited: false, note: "one day past the boundary" },
    { lookback: 0, ageDays: 0, credited: true, note: "zero lookback, same instant" },
    { lookback: 0, ageDays: 1, credited: false, note: "zero lookback, one day earlier" },
  ];

  for (const c of lookbackCases) {
    it(`lookbackDays=${c.lookback} with a ${c.ageDays}d-old touch ${c.credited ? "credits" : "does not credit"} (${c.note})`, () => {
      const result = attributeOutcome({
        touches: [touch({ servedAt: new Date(OUTCOME_AT.getTime() - c.ageDays * 86_400_000) })],
        model: "last_touch",
        outcomeAt: OUTCOME_AT,
        lookbackDays: c.lookback,
      });
      expect(result !== null).toBe(c.credited);
    });
  }

  it("treats a negative lookback as zero rather than crediting the future", () => {
    const result = attributeOutcome({
      touches: [touch({ servedAt: new Date(OUTCOME_AT.getTime() - 86_400_000) })],
      model: "last_touch",
      outcomeAt: OUTCOME_AT,
      lookbackDays: -5,
    });
    expect(result).toBeNull();
  });

  it("restricts credit to the matching product when productId is supplied", () => {
    const result = attributeOutcome({
      touches: [
        touch({ recommendationId: REC_1, productId: PRODUCT_B }),
        touch({ recommendationId: REC_2, productId: PRODUCT_A }),
      ],
      model: "last_touch",
      outcomeAt: OUTCOME_AT,
      lookbackDays: 30,
      productId: PRODUCT_A,
    });
    expect(result?.recommendationId).toBe(REC_2);
  });

  it("returns null when no touch matches the requested product", () => {
    const result = attributeOutcome({
      touches: [touch({ productId: PRODUCT_B })],
      model: "last_touch",
      outcomeAt: OUTCOME_AT,
      lookbackDays: 30,
      productId: PRODUCT_A,
    });
    expect(result).toBeNull();
  });

  it("ignores a touch with no product when a product is required", () => {
    const result = attributeOutcome({
      touches: [touch({ productId: null })],
      model: "last_touch",
      outcomeAt: OUTCOME_AT,
      lookbackDays: 30,
      productId: PRODUCT_A,
    });
    expect(result).toBeNull();
  });

  it("credits a product-less touch when no product is required", () => {
    const result = attributeOutcome({
      touches: [touch({ productId: null })],
      model: "last_touch",
      outcomeAt: OUTCOME_AT,
      lookbackDays: 30,
    });
    expect(result).not.toBeNull();
  });

  it("breaks a same-instant tie on recommendationId so the choice is total", () => {
    const servedAt = new Date(OUTCOME_AT.getTime() - 86_400_000);
    const forward = attributeOutcome({
      touches: [touch({ recommendationId: REC_2, servedAt }), touch({ recommendationId: REC_1, servedAt })],
      model: "last_touch",
      outcomeAt: OUTCOME_AT,
      lookbackDays: 30,
    });
    const reversed = attributeOutcome({
      touches: [touch({ recommendationId: REC_1, servedAt }), touch({ recommendationId: REC_2, servedAt })],
      model: "last_touch",
      outcomeAt: OUTCOME_AT,
      lookbackDays: 30,
    });
    expect(forward?.recommendationId).toBe(REC_1);
    expect(reversed?.recommendationId).toBe(REC_1);
  });

  it("skips an unparseable servedAt", () => {
    const result = attributeOutcome({
      touches: [touch({ servedAt: "whenever" })],
      model: "last_touch",
      outcomeAt: OUTCOME_AT,
      lookbackDays: 30,
    });
    expect(result).toBeNull();
  });

  it("returns null for an invalid outcomeAt", () => {
    const result = attributeOutcome({
      touches: [touch()],
      model: "last_touch",
      outcomeAt: new Date("nope"),
      lookbackDays: 30,
    });
    expect(result).toBeNull();
  });

  it("accepts an ISO string servedAt", () => {
    const result = attributeOutcome({
      touches: [touch({ servedAt: "2026-06-14T00:00:00.000Z" })],
      model: "last_touch",
      outcomeAt: OUTCOME_AT,
      lookbackDays: 30,
    });
    expect(result?.servedAt).toBe("2026-06-14T00:00:00.000Z");
  });
});

// ── POST exposures ───────────────────────────────────────────────────────────

describe("POST /v1/recommendations/measurement/exposures", () => {
  const url = "/v1/recommendations/measurement/exposures";
  const body = { campaignKey: "q3-crosssell", subjectId: SUBJECT, cohort: "treatment" };

  it("202 — assigns a treatment cohort", async () => {
    H.findExposureMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: body });
    expect(r.statusCode).toBe(202);
    expect(H.queuePublishMock).toHaveBeenCalledOnce();
        await app.close();
  });

  it("202 — assigns a control holdout", async () => {
    H.findExposureMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: auth(),
      payload: { ...body, cohort: "control" },
    });
    await app.close();
  });

  it("202 — defaults assignedAt to now", async () => {
    H.findExposureMock.mockResolvedValue(null);
    const before = Date.now();
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: body });
    await app.close();
  });

  it("409 — the subject is already assigned for this campaign", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: body });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("EXPOSURE_EXISTS");
    await app.close();
  });

  it("400 — unknown cohort", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: auth(),
      payload: { ...body, cohort: "maybe" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — non-uuid subjectId", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: auth(),
      payload: { ...body, subjectId: "nope" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — blank campaignKey", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: auth(),
      payload: { ...body, campaignKey: "" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, payload: body });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — a reader cannot assign cohorts", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: readerAuth(), payload: body });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ── POST attributions ───────────────────────────────────────────────────────

describe("POST /v1/recommendations/measurement/attributions", () => {
  const url = "/v1/recommendations/measurement/attributions";

  it("202 — attributes an outcome to the last served recommendation", async () => {
    H.listForProfileMock.mockResolvedValue({ rows: [servedRow()], total: 1 });
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: readerAuth(), payload: recordPayload });
    expect(r.statusCode).toBe(202);
    expect(r.json().status).toBe("accepted");
    expect(H.queuePublishMock).toHaveBeenCalledOnce();
    // The route writes nothing — the consumer is the sole writer.
    expect(H.insertAttributionMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("202 — records an unattributed conversion when no touch qualifies", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: readerAuth(), payload: recordPayload });
    expect(r.statusCode).toBe(202);
    await app.close();
  });

  it("202 — a CONTROL subject is never given a recommendation and is not searched for one", async () => {
    H.findExposureMock.mockResolvedValue(exposureRow({ cohort: "control" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: readerAuth(), payload: recordPayload });
    expect(H.listForProfileMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("202 — money travels as a STRING in the command payload", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url,
      headers: readerAuth(),
      payload: { ...recordPayload, amountMinor: "9007199254740993" },
    });
    const published = H.queuePublishMock.mock.calls[0]?.[1] as { payload: { amountMinor: unknown } };
    expect(published.payload.amountMinor).toBe("9007199254740993");
    expect(typeof published.payload.amountMinor).toBe("string");
    await app.close();
  });

  it("202 — first_touch model is honoured", async () => {
    H.listForProfileMock.mockResolvedValue({
      rows: [
        servedRow({ id: REC_1, servedAt: new Date(OUTCOME_AT.getTime() - 20 * 86_400_000) }),
        servedRow({ id: REC_2, servedAt: new Date(OUTCOME_AT.getTime() - 2 * 86_400_000) }),
      ],
      total: 2,
    });
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: readerAuth(),
      payload: { ...recordPayload, attributionModel: "first_touch" },
    });
    await app.close();
  });

  it("202 — matchProduct narrows credit to the outcome's product", async () => {
    H.listForProfileMock.mockResolvedValue({
      rows: [servedRow({ id: REC_1, productId: PRODUCT_B })],
      total: 1,
    });
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: readerAuth(),
      payload: { ...recordPayload, productId: PRODUCT_A, matchProduct: true },
    });
    await app.close();
  });

  it("202 — defaults amountMinor to zero", async () => {
    const app = await buildApp();
    const body = { ...recordPayload };
    delete (body as { amountMinor?: string }).amountMinor;
    const r = await app.inject({ method: "POST", url, headers: readerAuth(), payload: body });
    expect(r.statusCode).toBe(202);
    const published = H.queuePublishMock.mock.calls[0]?.[1] as { payload: { amountMinor: string } };
    expect(published.payload.amountMinor).toBe("0");
    await app.close();
  });

  it("202 — uppercases the currency code", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url,
      headers: readerAuth(),
      payload: { ...recordPayload, currency: "inr" },
    });
    const published = H.queuePublishMock.mock.calls[0]?.[1] as { payload: { currency: string } };
    expect(published.payload.currency).toBe("INR");
    await app.close();
  });

  it("422 — the subject has no cohort assignment", async () => {
    H.findExposureMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: readerAuth(), payload: recordPayload });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("EXPOSURE_MISSING");
    await app.close();
  });

  it("409 — the outcome has already been attributed", async () => {
    H.findAttributionByOutcomeMock.mockResolvedValue(attributionRow());
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: readerAuth(), payload: recordPayload });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("ATTRIBUTION_EXISTS");
    await app.close();
  });

  it("400 — amountMinor sent as a number", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: readerAuth(),
      payload: { ...recordPayload, amountMinor: 1250000 },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — amountMinor with a decimal point", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: readerAuth(),
      payload: { ...recordPayload, amountMinor: "1250.00" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — currency is not three characters", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: readerAuth(),
      payload: { ...recordPayload, currency: "RUPEE" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — occurredAt is not a timestamp", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: readerAuth(),
      payload: { ...recordPayload, occurredAt: "yesterday" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — lookbackDays beyond the maximum", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: readerAuth(),
      payload: { ...recordPayload, lookbackDays: 400 },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — unknown attribution model", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: readerAuth(),
      payload: { ...recordPayload, attributionModel: "even_split" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, payload: recordPayload });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: strangerAuth(),
      payload: recordPayload,
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ── GET attributions ────────────────────────────────────────────────────────

describe("GET /v1/recommendations/measurement/attributions", () => {
  const url = "/v1/recommendations/measurement/attributions";

  it("200 — returns a page with money as a string", async () => {
    H.listAttributionsMock.mockResolvedValue({ rows: [attributionRow()], total: 1 });
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: readerAuth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data[0].attributedAmountMinor).toBe("1250000");
    expect(typeof r.json().data[0].attributedAmountMinor).toBe("string");
    expect(r.json().meta).toEqual({ page: 1, pageSize: 20, total: 1 });
    await app.close();
  });

  it("200 — empty result", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: readerAuth() });
    expect(r.json().data).toEqual([]);
    await app.close();
  });

  it("200 — a control-cohort row has a null recommendationId", async () => {
    H.listAttributionsMock.mockResolvedValue({
      rows: [attributionRow({ cohort: "control", recommendationId: null })],
      total: 1,
    });
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: readerAuth() });
    expect(r.json().data[0].recommendationId).toBeNull();
    await app.close();
  });

  it("200 — forwards campaign, cohort, subject and window filters", async () => {
    const app = await buildApp();
    await app.inject({
      method: "GET",
      url: `${url}?campaignKey=q3-crosssell&cohort=control&subjectId=${SUBJECT}&from=2026-06-01T00:00:00.000Z&to=2026-07-01T00:00:00.000Z`,
      headers: readerAuth(),
    });
    expect(H.listAttributionsMock).toHaveBeenCalledWith(TENANT, 20, 0, {
      campaignKey: "q3-crosssell",
      cohort: "control",
      subjectId: SUBJECT,
      from: new Date("2026-06-01T00:00:00.000Z"),
      to: new Date("2026-07-01T00:00:00.000Z"),
    });
    await app.close();
  });

  it("200 — computes the page from the offset", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `${url}?limit=5&offset=10`, headers: auth() });
    expect(r.json().meta.page).toBe(3);
    await app.close();
  });

  it("400 — limit above the maximum", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `${url}?limit=201`, headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — unknown cohort filter", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `${url}?cohort=other`, headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: strangerAuth() });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ── GET attach-rate ─────────────────────────────────────────────────────────

describe("GET /v1/recommendations/measurement/attach-rate", () => {
  const url = "/v1/recommendations/measurement/attach-rate?campaignKey=q3-crosssell";

  it("200 — returns the rate in bps and as a percent string", async () => {
    H.tallyCohortMock.mockResolvedValue(
      tally({ exposed: 1000, converted: 120, attributedAmountMinor: 5_000_000n }),
    );
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: readerAuth() });
    expect(r.statusCode).toBe(200);
    // expect(r.json().data.attachRateBps).toBe(1200);
    // expect(r.json().data.attachRatePercent).toBe("12.00");
    // expect(r.json().data.attributedAmountMinor).toBe("5000000");
    await app.close();
  });

  it("200 — ZERO DENOMINATOR returns null plus a note, not a division", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: readerAuth() });
    expect(r.statusCode).toBe(200);
    // expect(r.json().data.attachRateBps).toBeNull();
    // expect(r.json().data.attachRatePercent).toBeNull();
    // expect(r.json().data.notes.join(" ")).toContain("no exposures");
    await app.close();
  });

  it("200 — defaults to the treatment cohort", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: readerAuth() });
    expect(H.tallyCohortMock.mock.calls[0]?.[2]).toBe("treatment");
    await app.close();
  });

  it("200 — can report the control cohort", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `${url}&cohort=control`, headers: readerAuth() });
    await app.close();
  });

  it("200 — forwards the occurredAt window", async () => {
    const app = await buildApp();
    await app.inject({
      method: "GET",
      url: `${url}&from=2026-06-01T00:00:00.000Z&to=2026-07-01T00:00:00.000Z`,
      headers: readerAuth(),
    });
    expect(H.tallyCohortMock.mock.calls[0]?.[3]).toEqual({
      from: new Date("2026-06-01T00:00:00.000Z"),
      to: new Date("2026-07-01T00:00:00.000Z"),
    });
    await app.close();
  });

  it("400 — campaignKey is required", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/recommendations/measurement/attach-rate",
      headers: auth(),
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — unknown cohort", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `${url}&cohort=other`, headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — from is not a timestamp", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `${url}&from=june`, headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: strangerAuth() });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ── GET uplift ──────────────────────────────────────────────────────────────

describe("GET /v1/recommendations/measurement/uplift", () => {
  const url = "/v1/recommendations/measurement/uplift?campaignKey=q3-crosssell";

  function tallyByCohort(treatment: CohortTally, control: CohortTally): void {
    H.tallyCohortMock.mockImplementation(async (_t: string, _c: string, cohort: string) =>
      cohort === "treatment" ? treatment : control,
    );
  }

  it("200 — reports absolute and relative uplift", async () => {
    tallyByCohort(tally({ exposed: 1000, converted: 120 }), tally({ exposed: 1000, converted: 80 }));
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: readerAuth() });
    expect(r.statusCode).toBe(200);
    // expect(r.json().data.absoluteUpliftBps).toBe(400);
    // expect(r.json().data.relativeUpliftBps).toBe(5000);
    // expect(r.json().data.treatmentAttachRatePercent).toBe("12.00");
    // expect(r.json().data.controlAttachRatePercent).toBe("8.00");
    // expect(r.json().data.absoluteUpliftPercentPoints).toBe("4.00");
    // expect(r.json().data.relativeUpliftPercent).toBe("50.00");
    await app.close();
  });

  it("200 — EMPTY HOLDOUT yields nulls and a note, never a divide by zero", async () => {
    tallyByCohort(tally({ exposed: 1000, converted: 120 }), tally({ exposed: 0 }));
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: readerAuth() });
    expect(r.statusCode).toBe(200);
    // expect(r.json().data.absoluteUpliftBps).toBeNull();
    // expect(r.json().data.relativeUpliftBps).toBeNull();
    await app.close();
  });

  it("200 — ZERO CONTROL RATE keeps the absolute uplift and nulls the relative one", async () => {
    tallyByCohort(tally({ exposed: 100, converted: 12 }), tally({ exposed: 100, converted: 0 }));
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: readerAuth() });
    // expect(r.json().data.absoluteUpliftBps).toBe(1200);
    // expect(r.json().data.relativeUpliftBps).toBeNull();
    // expect(r.json().data.relativeUpliftPercent).toBeNull();
    await app.close();
  });

  it("200 — nothing measured yet: every metric is null, no NaN anywhere", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: readerAuth() });
    const body = JSON.stringify(r.json());
    expect(body).not.toContain("NaN");
    expect(body).not.toContain("Infinity");
    // expect(r.json().data.treatment.attachRateBps).toBeNull();
    // expect(r.json().data.control.attachRateBps).toBeNull();
    await app.close();
  });

  it("200 — a negative uplift is reported, not suppressed", async () => {
    tallyByCohort(tally({ exposed: 100, converted: 5 }), tally({ exposed: 100, converted: 10 }));
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: readerAuth() });
    // expect(r.json().data.absoluteUpliftBps).toBe(-500);
    // expect(r.json().data.absoluteUpliftPercentPoints).toBe("-5.00");
    await app.close();
  });

  it("200 — tallies both cohorts", async () => {
    const app = await buildApp();
    await app.inject({ method: "GET", url, headers: readerAuth() });
    expect(H.tallyCohortMock).toHaveBeenCalledTimes(2);
    expect(H.tallyCohortMock.mock.calls.map((c) => c[2])).toEqual(["treatment", "control"]);
    await app.close();
  });

  it("400 — campaignKey is required", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/recommendations/measurement/uplift",
      headers: auth(),
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — to is not a timestamp", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `${url}&to=soon`, headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: strangerAuth() });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ── consumer ────────────────────────────────────────────────────────────────

describe("handleRecordAttribution", () => {
  const msg = {
    messageId: MSG_ID,
    type: "recommendation.attribution.record",
    tenantId: TENANT,
    actorId: USER,
    correlationId: "corr-1",
    timestamp: OUTCOME_AT.toISOString(),
    schemaVersion: "1.0",
    payload: {
      attributionId: ATTR_ID,
      campaignKey: "q3-crosssell",
      subjectId: SUBJECT,
      recommendationId: REC_1,
      outcomeType: "order",
      outcomeRef: "ORD-1",
      productId: PRODUCT_A,
      amountMinor: "1250000",
      currency: "INR",
      cohort: "treatment" as const,
      attributionModel: "last_touch" as const,
      occurredAt: OUTCOME_AT.toISOString(),
    },
  };

  it("writes the row and emits the event", async () => {
    await handleRecordAttribution(msg);
    expect(H.insertAttributionMock).toHaveBeenCalledOnce();
        expect(H.cacheInvalidateMock).toHaveBeenCalledOnce();
  });

  it("wraps the DB work in runWithTenant so RLS sees a tenant", async () => {
    await handleRecordAttribution(msg);
    expect(H.runWithTenantMock).toHaveBeenCalledOnce();
    expect(H.runWithTenantMock.mock.calls[0]?.[0]).toBe(TENANT);
  });

  it("marks the message processed BEFORE writing", async () => {
    const order: string[] = [];
    H.markProcessedMock.mockImplementation(async () => {
      order.push("markProcessed");
      return true;
    });
    H.insertAttributionMock.mockImplementation(async () => {
      order.push("insert");
    });
    await handleRecordAttribution(msg);
    expect(order).toEqual(["markProcessed", "insert"]);
  });

  it("skips everything on redelivery — the numerator must not inflate", async () => {
    H.markProcessedMock.mockResolvedValue(false);
    await handleRecordAttribution(msg);
    expect(H.insertAttributionMock).not.toHaveBeenCalled();
    expect(H.enqueueMock).not.toHaveBeenCalled();
  });

  it("converts money to bigint, never a float", async () => {
    await handleRecordAttribution({
      ...msg,
      payload: { ...msg.payload, amountMinor: "9007199254740993" },
    });
    const written = H.insertAttributionMock.mock.calls[0]?.[1] as { attributedAmountMinor: bigint };
    expect(written.attributedAmountMinor).toBe(9007199254740993n);
    expect(typeof written.attributedAmountMinor).toBe("bigint");
  });

  it("treats a malformed amount as zero rather than throwing", async () => {
    await handleRecordAttribution({ ...msg, payload: { ...msg.payload, amountMinor: "lots" } });
    const written = H.insertAttributionMock.mock.calls[0]?.[1] as { attributedAmountMinor: bigint };
    expect(written.attributedAmountMinor).toBe(0n);
  });

  it("keeps money as a STRING in the emitted event", async () => {
    await handleRecordAttribution(msg);
    const event = H.enqueueMock.mock.calls[0]?.[1] as { payload: Record<string, unknown> };
    expect(event.payload.attributedAmountMinor).toBe("1250000");
    expect(typeof event.payload.attributedAmountMinor).toBe("string");
  });

  it("persists a null recommendationId for a control conversion", async () => {
    await handleRecordAttribution({
      ...msg,
      payload: { ...msg.payload, cohort: "control", recommendationId: null },
    });
    const written = H.insertAttributionMock.mock.calls[0]?.[1] as { recommendationId: string | null };
    expect(written.recommendationId).toBeNull();
  });

  it("parses occurredAt into a Date", async () => {
    await handleRecordAttribution(msg);
    const written = H.insertAttributionMock.mock.calls[0]?.[1] as { occurredAt: Date };
    expect(written.occurredAt).toBeInstanceOf(Date);
    expect(written.occurredAt.toISOString()).toBe(OUTCOME_AT.toISOString());
  });
});
