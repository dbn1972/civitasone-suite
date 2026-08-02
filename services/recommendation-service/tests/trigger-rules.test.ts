/**
 * IN-007 / FS-006 / MP-011 — generic trigger rules: domain evaluation for all three
 * rule shapes plus the configuration and evaluation routes.
 *
 * Each rule type is exercised table-driven across its thresholds, including the
 * boundary values (exactly-at-threshold, zero, absent) and the fail-closed paths.
 *
 * The three RTM rows are expressed here as CONFIGURATION, not as code paths:
 *   IN-007 → a holding_based rule whose sourceCategory is a savings-type category
 *            and whose targetCategory is a protection/insurance category.
 *   FS-006 → life_event rules keyed on maturity/address/age event codes.
 *   MP-011 → a volume_pattern rule with lane and volume thresholds.
 * The category and event-code strings below are test fixtures, not platform
 * vocabulary — nothing in src/ knows them.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import {
  MAX_CODE_LENGTH,
  evaluateTriggers,
  isTriggerRuleType,
  normaliseCode,
  parseMinorUnits,
  sumMinorUnits,
  triggersToCandidates,
  validateConditions,
  validateRuleShape,
  type EvaluableRule,
  type SubjectObservation,
} from "../src/modules/triggers/domain.js";
import { TRIGGER_RULE_TYPES } from "../src/modules/triggers/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const SUBJECT = "bbbbbbbb-1111-4000-8000-000000000001";
const RULE_ID = "cccccccc-1111-4000-8000-000000000001";
const PRODUCT_A = "11111111-1111-4111-8111-111111111111";

const ASOF = new Date("2026-06-15T00:00:00.000Z");

const H = vi.hoisted(() => ({
  dbTransactionMock: vi.fn(),
  enqueueMock: vi.fn(),
  cacheGetOrLoadMock: vi.fn(),
  cacheInvalidateMock: vi.fn(),
  cacheMakeKeyMock: vi.fn(),
  queuePublishMock: vi.fn(),
  findByIdMock: vi.fn(),
  findByNameMock: vi.fn(),
  listByTenantMock: vi.fn(),
  listEvaluableMock: vi.fn(),
  insertMock: vi.fn(),
  updateMock: vi.fn(),
  deactivateMock: vi.fn(),
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

vi.mock("../src/modules/triggers/repo.js", async () => {
  const actual = await import("../src/modules/triggers/repo.js");
  return {
    toView: actual.toView,
    findById: (...a: unknown[]) => H.findByIdMock(...a),
    findByName: (...a: unknown[]) => H.findByNameMock(...a),
    listByTenant: (...a: unknown[]) => H.listByTenantMock(...a),
    listEvaluable: (...a: unknown[]) => H.listEvaluableMock(...a),
    insert: (...a: unknown[]) => H.insertMock(...a),
    update: (...a: unknown[]) => H.updateMock(...a),
    deactivate: (...a: unknown[]) => H.deactivateMock(...a),
  };
});

import { buildApp } from "../src/app.js";

const tok = (roles: string[]) => signToken({ sub: USER, tid: TENANT, roles, sid: "sess-1" }, SECRET);
const auth = (roles = ["recommendation_admin"]) => ({ authorization: `Bearer ${tok(roles)}` });
const readerAuth = () => auth(["crm_user"]);
const strangerAuth = () => auth(["viewer"]);

function rule(overrides: Partial<EvaluableRule> = {}): EvaluableRule {
  return {
    id: RULE_ID,
    ruleType: "holding_based",
    name: "test rule",
    sourceCategory: "savings",
    targetCategory: "protection",
    conditions: {},
    priority: 0,
    weightBps: 0,
    active: true,
    ...overrides,
  };
}

function ruleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RULE_ID,
    tenantId: TENANT,
    ruleType: "holding_based",
    name: "test rule",
    sourceCategory: "savings",
    targetCategory: "protection",
    eventCode: null,
    conditions: {},
    priority: 5,
    weightBps: 5000,
    active: true,
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
  H.listEvaluableMock.mockResolvedValue([]);
  H.findByNameMock.mockResolvedValue(null);
  H.insertMock.mockResolvedValue(undefined);
  H.updateMock.mockResolvedValue(true);
  H.deactivateMock.mockResolvedValue(true);
});

// ── helpers ───────────────────────────────────────────────────────────────────

describe("isTriggerRuleType", () => {
  it("accepts every declared type", () => {
    for (const t of TRIGGER_RULE_TYPES) expect(isTriggerRuleType(t)).toBe(true);
  });

  it("rejects an unknown type", () => {
    expect(isTriggerRuleType("posb_insurance")).toBe(false);
  });

  it("declares exactly three generic shapes", () => {
    expect(TRIGGER_RULE_TYPES).toEqual(["holding_based", "life_event", "volume_pattern"]);
  });
});

describe("normaliseCode", () => {
  const cases: { input: string | null | undefined; expected: string }[] = [
    { input: "savings", expected: "savings" },
    { input: "  Savings  ", expected: "savings" },
    { input: "SAVINGS", expected: "savings" },
    { input: "", expected: "" },
    { input: "   ", expected: "" },
    { input: null, expected: "" },
    { input: undefined, expected: "" },
  ];
  for (const c of cases) {
    it(`${JSON.stringify(c.input)} → ${JSON.stringify(c.expected)}`, () => {
      expect(normaliseCode(c.input)).toBe(c.expected);
    });
  }

  it("MAX_CODE_LENGTH matches the varchar width", () => {
    expect(MAX_CODE_LENGTH).toBe(64);
  });
});

describe("parseMinorUnits", () => {
  const cases: { input: string | null | undefined; expected: bigint | null }[] = [
    { input: "0", expected: 0n },
    { input: "100", expected: 100n },
    { input: " 250 ", expected: 250n },
    { input: "-5", expected: -5n },
    // Above 2^53 — the reason money is a string, not a JSON number.
    { input: "9007199254740993", expected: 9007199254740993n },
    { input: "1.5", expected: null },
    { input: "lots", expected: null },
    { input: "", expected: null },
    { input: null, expected: null },
    { input: undefined, expected: null },
  ];
  for (const c of cases) {
    it(`${JSON.stringify(c.input)} → ${c.expected === null ? "null" : c.expected.toString()}`, () => {
      expect(parseMinorUnits(c.input)).toBe(c.expected);
    });
  }
});

describe("sumMinorUnits", () => {
  it("is 0 for an empty list", () => {
    expect(sumMinorUnits([])).toBe(0n);
  });

  it("adds in bigint", () => {
    expect(sumMinorUnits(["100", "250"])).toBe(350n);
  });

  it("keeps precision beyond 2^53", () => {
    expect(sumMinorUnits(["9007199254740993", "1"])).toBe(9007199254740994n);
  });

  it("skips absent and malformed entries rather than throwing", () => {
    expect(sumMinorUnits(["100", undefined, "bad", null, "1"])).toBe(101n);
  });
});

// ── holding_based (IN-007 shape) ──────────────────────────────────────────────

describe("evaluateTriggers — holding_based", () => {
  const savingsHolding = { productId: PRODUCT_A, category: "savings", valueMinor: "500000" };

  it("fires when the subject holds the source category", () => {
    const raised = evaluateTriggers({
      rules: [rule()],
      observation: { holdings: [savingsHolding] },
      asOf: ASOF,
    });
    expect(raised).toHaveLength(1);
    expect(raised[0]?.targetCategory).toBe("protection");
    expect(raised[0]?.evidence.holdingCount).toBe(1);
  });

  it("does not fire when the subject holds nothing in the source category", () => {
    const raised = evaluateTriggers({
      rules: [rule()],
      observation: { holdings: [{ productId: PRODUCT_A, category: "logistics" }] },
      asOf: ASOF,
    });
    expect(raised).toEqual([]);
  });

  it("does not fire with no holdings at all", () => {
    expect(evaluateTriggers({ rules: [rule()], observation: {}, asOf: ASOF })).toEqual([]);
  });

  it("matches the source category case-insensitively", () => {
    const raised = evaluateTriggers({
      rules: [rule({ sourceCategory: "SAVINGS" })],
      observation: { holdings: [savingsHolding] },
      asOf: ASOF,
    });
    expect(raised).toHaveLength(1);
  });

  it("cannot fire without a sourceCategory — an untestable rule fires on nothing", () => {
    const raised = evaluateTriggers({
      rules: [rule({ sourceCategory: null })],
      observation: { holdings: [savingsHolding] },
      asOf: ASOF,
    });
    expect(raised).toEqual([]);
  });

  const countCases: { min: number; holdings: number; fires: boolean; note: string }[] = [
    { min: 1, holdings: 1, fires: true, note: "exactly at threshold" },
    { min: 2, holdings: 1, fires: false, note: "one short" },
    { min: 2, holdings: 2, fires: true, note: "exactly at threshold" },
    { min: 2, holdings: 3, fires: true, note: "over threshold" },
    { min: 0, holdings: 1, fires: true, note: "zero threshold is no threshold" },
  ];

  for (const c of countCases) {
    it(`minHoldingCount=${c.min} with ${c.holdings} holdings ${c.fires ? "fires" : "does not fire"} (${c.note})`, () => {
      const holdings = Array.from({ length: c.holdings }, (_, i) => ({
        productId: `p${i}`,
        category: "savings",
      }));
      const raised = evaluateTriggers({
        rules: [rule({ conditions: { minHoldingCount: c.min } })],
        observation: { holdings },
        asOf: ASOF,
      });
      expect(raised.length > 0).toBe(c.fires);
    });
  }

  const valueCases: { threshold: string; values: string[]; fires: boolean; note: string }[] = [
    { threshold: "500000", values: ["500000"], fires: true, note: "exactly at threshold" },
    { threshold: "500000", values: ["499999"], fires: false, note: "one minor unit short" },
    { threshold: "500000", values: ["250000", "250000"], fires: true, note: "aggregate reaches it" },
    { threshold: "0", values: [], fires: true, note: "zero threshold with no values" },
    {
      threshold: "9007199254740993",
      values: ["9007199254740993"],
      fires: true,
      note: "beyond 2^53 — bigint, not float",
    },
  ];

  for (const c of valueCases) {
    it(`minHoldingValueMinor=${c.threshold} ${c.fires ? "fires" : "does not fire"} (${c.note})`, () => {
      const holdings = c.values.map((valueMinor, i) => ({
        productId: `p${i}`,
        category: "savings",
        valueMinor,
      }));
      // A value-gated rule still needs at least one matching holding to test.
      if (holdings.length === 0) holdings.push({ productId: "p0", category: "savings", valueMinor: "0" });
      const raised = evaluateTriggers({
        rules: [rule({ conditions: { minHoldingValueMinor: c.threshold } })],
        observation: { holdings },
        asOf: ASOF,
      });
      expect(raised.length > 0).toBe(c.fires);
    });
  }

  it("reports the aggregate held value as a STRING", () => {
    const raised = evaluateTriggers({
      rules: [rule({ conditions: { minHoldingValueMinor: "1" } })],
      observation: { holdings: [savingsHolding] },
      asOf: ASOF,
    });
    expect(raised[0]?.evidence.holdingValueMinor).toBe("500000");
    expect(typeof raised[0]?.evidence.holdingValueMinor).toBe("string");
  });

  it("fails closed on a malformed value threshold", () => {
    const raised = evaluateTriggers({
      rules: [rule({ conditions: { minHoldingValueMinor: "a lot" } })],
      observation: { holdings: [savingsHolding] },
      asOf: ASOF,
    });
    expect(raised).toEqual([]);
  });

  it("holdings without a value contribute nothing to the aggregate", () => {
    const raised = evaluateTriggers({
      rules: [rule({ conditions: { minHoldingValueMinor: "1" } })],
      observation: { holdings: [{ productId: PRODUCT_A, category: "savings" }] },
      asOf: ASOF,
    });
    expect(raised).toEqual([]);
  });
});

// ── life_event (FS-006 shape) ─────────────────────────────────────────────────

describe("evaluateTriggers — life_event", () => {
  const lifeRule = (conditions = {}, eventCode = "maturity_approaching") =>
    rule({ ruleType: "life_event", sourceCategory: null, eventCode, conditions });

  it("fires on a matching event code", () => {
    const raised = evaluateTriggers({
      rules: [lifeRule()],
      observation: { lifeEvents: [{ eventCode: "maturity_approaching", occurredAt: ASOF }] },
      asOf: ASOF,
    });
    expect(raised).toHaveLength(1);
    expect(raised[0]?.evidence.eventCode).toBe("maturity_approaching");
  });

  it("does not fire on a different event code", () => {
    const raised = evaluateTriggers({
      rules: [lifeRule()],
      observation: { lifeEvents: [{ eventCode: "address_change", occurredAt: ASOF }] },
      asOf: ASOF,
    });
    expect(raised).toEqual([]);
  });

  it("cannot fire without an eventCode configured", () => {
    const raised = evaluateTriggers({
      rules: [rule({ ruleType: "life_event", sourceCategory: null, eventCode: null })],
      observation: { lifeEvents: [{ eventCode: "anything", occurredAt: ASOF }] },
      asOf: ASOF,
    });
    expect(raised).toEqual([]);
  });

  it("does not fire with no events", () => {
    expect(evaluateTriggers({ rules: [lifeRule()], observation: {}, asOf: ASOF })).toEqual([]);
  });

  const dayCases: { withinDays: number; offsetDays: number; fires: boolean; note: string }[] = [
    { withinDays: 30, offsetDays: 0, fires: true, note: "today" },
    { withinDays: 30, offsetDays: 30, fires: true, note: "exactly at the boundary — INCLUSIVE" },
    { withinDays: 30, offsetDays: 31, fires: false, note: "one day past the boundary" },
    { withinDays: 30, offsetDays: -30, fires: true, note: "30 days in the PAST — absolute distance" },
    { withinDays: 30, offsetDays: -31, fires: false, note: "31 days in the past" },
    { withinDays: 0, offsetDays: 0, fires: true, note: "zero window, same instant" },
    { withinDays: 0, offsetDays: 1, fires: false, note: "zero window, next day" },
  ];

  for (const c of dayCases) {
    it(`withinDays=${c.withinDays}, event ${c.offsetDays}d away ${c.fires ? "fires" : "does not fire"} (${c.note})`, () => {
      const occurredAt = new Date(ASOF.getTime() + c.offsetDays * 86_400_000);
      const raised = evaluateTriggers({
        rules: [lifeRule({ withinDays: c.withinDays })],
        observation: { lifeEvents: [{ eventCode: "maturity_approaching", occurredAt }] },
        asOf: ASOF,
      });
      expect(raised.length > 0).toBe(c.fires);
    });
  }

  it("labels a future event as upcoming", () => {
    const raised = evaluateTriggers({
      rules: [lifeRule({ withinDays: 60 })],
      observation: {
        lifeEvents: [
          { eventCode: "maturity_approaching", occurredAt: new Date(ASOF.getTime() + 86_400_000) },
        ],
      },
      asOf: ASOF,
    });
    expect(raised[0]?.evidence.direction).toBe("upcoming");
  });

  it("labels a past event as past", () => {
    const raised = evaluateTriggers({
      rules: [lifeRule({ withinDays: 60 }, "address_change")],
      observation: {
        lifeEvents: [{ eventCode: "address_change", occurredAt: new Date(ASOF.getTime() - 86_400_000) }],
      },
      asOf: ASOF,
    });
    expect(raised[0]?.evidence.direction).toBe("past");
  });

  const ageCases: {
    min?: number;
    max?: number;
    age?: number;
    fires: boolean;
    note: string;
  }[] = [
    { min: 60, age: 60, fires: true, note: "exactly at minAge" },
    { min: 60, age: 59, fires: false, note: "one year short of minAge" },
    { max: 25, age: 25, fires: true, note: "exactly at maxAge" },
    { max: 25, age: 26, fires: false, note: "one year over maxAge" },
    { min: 25, max: 60, age: 40, fires: true, note: "inside the band" },
    { min: 25, max: 60, age: 24, fires: false, note: "below the band" },
    { min: 25, max: 60, age: 61, fires: false, note: "above the band" },
    { min: 60, fires: false, note: "age gate with unknown age — fails CLOSED" },
    { min: 0, age: 0, fires: true, note: "zero minAge with age 0" },
  ];

  for (const c of ageCases) {
    it(`age gate ${JSON.stringify({ min: c.min, max: c.max })} with age ${c.age} ${c.fires ? "fires" : "does not fire"} (${c.note})`, () => {
      const raised = evaluateTriggers({
        rules: [
          lifeRule(
            {
              ...(c.min !== undefined ? { minAgeYears: c.min } : {}),
              ...(c.max !== undefined ? { maxAgeYears: c.max } : {}),
            },
            "age_threshold",
          ),
        ],
        observation: {
          lifeEvents: [
            {
              eventCode: "age_threshold",
              occurredAt: ASOF,
              ...(c.age !== undefined ? { ageYears: c.age } : {}),
            },
          ],
        },
        asOf: ASOF,
      });
      expect(raised.length > 0).toBe(c.fires);
    });
  }

  it("skips an event with an unparseable timestamp", () => {
    const raised = evaluateTriggers({
      rules: [lifeRule({ withinDays: 30 })],
      observation: { lifeEvents: [{ eventCode: "maturity_approaching", occurredAt: "soon" }] },
      asOf: ASOF,
    });
    expect(raised).toEqual([]);
  });

  it("fires on the first eligible event when several match", () => {
    const raised = evaluateTriggers({
      rules: [lifeRule({ withinDays: 5 })],
      observation: {
        lifeEvents: [
          { eventCode: "maturity_approaching", occurredAt: new Date(ASOF.getTime() + 99 * 86_400_000) },
          { eventCode: "maturity_approaching", occurredAt: ASOF },
        ],
      },
      asOf: ASOF,
    });
    expect(raised).toHaveLength(1);
    expect(raised[0]?.evidence.daysFromAsOf).toBe(0);
  });
});

// ── volume_pattern (MP-011 shape) ─────────────────────────────────────────────

describe("evaluateTriggers — volume_pattern", () => {
  const volRule = (conditions = {}) =>
    rule({ ruleType: "volume_pattern", sourceCategory: null, targetCategory: "premium", conditions });

  const pattern = (over: Record<string, unknown> = {}) => ({
    laneCode: "lane-1",
    consignmentCount: 100,
    windowDays: 30,
    ...over,
  });

  it("does not fire with no lane observations", () => {
    expect(evaluateTriggers({ rules: [volRule()], observation: {}, asOf: ASOF })).toEqual([]);
  });

  it("fires with no thresholds once any pattern is present", () => {
    const raised = evaluateTriggers({
      rules: [volRule()],
      observation: { lanePatterns: [pattern()] },
      asOf: ASOF,
    });
    expect(raised).toHaveLength(1);
    expect(raised[0]?.targetCategory).toBe("premium");
  });

  const volumeCases: { min: number; counts: number[]; fires: boolean; note: string }[] = [
    { min: 100, counts: [100], fires: true, note: "exactly at threshold" },
    { min: 100, counts: [99], fires: false, note: "one short" },
    { min: 100, counts: [60, 40], fires: true, note: "AGGREGATE across lanes reaches it" },
    { min: 100, counts: [60, 39], fires: false, note: "aggregate one short" },
    { min: 0, counts: [0], fires: true, note: "zero threshold" },
  ];

  for (const c of volumeCases) {
    it(`minVolume=${c.min} with counts ${JSON.stringify(c.counts)} ${c.fires ? "fires" : "does not fire"} (${c.note})`, () => {
      const raised = evaluateTriggers({
        rules: [volRule({ minVolume: c.min })],
        observation: {
          lanePatterns: c.counts.map((consignmentCount, i) =>
            pattern({ laneCode: `lane-${i}`, consignmentCount }),
          ),
        },
        asOf: ASOF,
      });
      expect(raised.length > 0).toBe(c.fires);
    });
  }

  const laneCases: { min: number; lanes: string[]; fires: boolean; note: string }[] = [
    { min: 3, lanes: ["a", "b", "c"], fires: true, note: "exactly at threshold" },
    { min: 3, lanes: ["a", "b"], fires: false, note: "one short" },
    { min: 2, lanes: ["a", "a", "a"], fires: false, note: "repeats are one DISTINCT lane" },
    { min: 2, lanes: ["A", "a", "b"], fires: true, note: "lane codes are case-insensitive" },
    { min: 1, lanes: ["   "], fires: false, note: "a blank lane code counts for nothing" },
  ];

  for (const c of laneCases) {
    it(`minDistinctLanes=${c.min} with ${JSON.stringify(c.lanes)} ${c.fires ? "fires" : "does not fire"} (${c.note})`, () => {
      const raised = evaluateTriggers({
        rules: [volRule({ minDistinctLanes: c.min })],
        observation: { lanePatterns: c.lanes.map((laneCode) => pattern({ laneCode })) },
        asOf: ASOF,
      });
      expect(raised.length > 0).toBe(c.fires);
    });
  }

  const windowCases: { min: number; windows: number[]; fires: boolean; note: string }[] = [
    { min: 30, windows: [30], fires: true, note: "exactly at threshold" },
    { min: 30, windows: [29], fires: false, note: "one day short" },
    { min: 30, windows: [7, 90], fires: true, note: "the WIDEST window is used" },
  ];

  for (const c of windowCases) {
    it(`minWindowDays=${c.min} with ${JSON.stringify(c.windows)} ${c.fires ? "fires" : "does not fire"} (${c.note})`, () => {
      const raised = evaluateTriggers({
        rules: [volRule({ minWindowDays: c.min })],
        observation: {
          lanePatterns: c.windows.map((windowDays, i) =>
            pattern({ laneCode: `lane-${i}`, windowDays }),
          ),
        },
        asOf: ASOF,
      });
      expect(raised.length > 0).toBe(c.fires);
    });
  }

  it("aggregates lane value in bigint and reports it as a string", () => {
    const raised = evaluateTriggers({
      rules: [volRule({ minValueMinor: "9007199254740994" })],
      observation: {
        lanePatterns: [
          pattern({ laneCode: "a", valueMinor: "9007199254740993" }),
          pattern({ laneCode: "b", valueMinor: "1" }),
        ],
      },
      asOf: ASOF,
    });
    expect(raised).toHaveLength(1);
    expect(raised[0]?.evidence.valueMinor).toBe("9007199254740994");
  });

  it("does not fire when aggregate value is one minor unit short", () => {
    const raised = evaluateTriggers({
      rules: [volRule({ minValueMinor: "1000" })],
      observation: { lanePatterns: [pattern({ valueMinor: "999" })] },
      asOf: ASOF,
    });
    expect(raised).toEqual([]);
  });

  it("fails closed on a malformed value threshold", () => {
    const raised = evaluateTriggers({
      rules: [volRule({ minValueMinor: "heaps" })],
      observation: { lanePatterns: [pattern({ valueMinor: "999999" })] },
      asOf: ASOF,
    });
    expect(raised).toEqual([]);
  });

  it("ignores a negative consignment count rather than subtracting", () => {
    const raised = evaluateTriggers({
      rules: [volRule({ minVolume: 100 })],
      observation: {
        lanePatterns: [
          pattern({ laneCode: "a", consignmentCount: 100 }),
          pattern({ laneCode: "b", consignmentCount: -50 }),
        ],
      },
      asOf: ASOF,
    });
    expect(raised).toHaveLength(1);
    expect(raised[0]?.evidence.consignmentCount).toBe(100);
  });
});

// ── cross-cutting gates ───────────────────────────────────────────────────────

describe("evaluateTriggers — gating and ordering", () => {
  const held = [{ productId: PRODUCT_A, category: "savings" }];

  it("skips an inactive rule", () => {
    expect(
      evaluateTriggers({ rules: [rule({ active: false })], observation: { holdings: held }, asOf: ASOF }),
    ).toEqual([]);
  });

  it("skips a rule outside its effective window", () => {
    expect(
      evaluateTriggers({
        rules: [rule({ effectiveTo: "2026-01-01T00:00:00.000Z" })],
        observation: { holdings: held },
        asOf: ASOF,
      }),
    ).toEqual([]);
  });

  it("includes a rule live exactly at effectiveFrom", () => {
    expect(
      evaluateTriggers({
        rules: [rule({ effectiveFrom: ASOF.toISOString() })],
        observation: { holdings: held },
        asOf: ASOF,
      }),
    ).toHaveLength(1);
  });

  it("skips a rule expiring exactly at asOf", () => {
    expect(
      evaluateTriggers({
        rules: [rule({ effectiveTo: ASOF.toISOString() })],
        observation: { holdings: held },
        asOf: ASOF,
      }),
    ).toEqual([]);
  });

  it("skips a rule with a blank targetCategory", () => {
    expect(
      evaluateTriggers({
        rules: [rule({ targetCategory: "   " })],
        observation: { holdings: held },
        asOf: ASOF,
      }),
    ).toEqual([]);
  });

  it("suppresses a trigger whose target category is already held", () => {
    expect(
      evaluateTriggers({
        rules: [rule()],
        observation: { holdings: [...held, { productId: "p2", category: "protection" }] },
        asOf: ASOF,
      }),
    ).toEqual([]);
  });

  it("keeps it when suppressWhenTargetHeld is false", () => {
    expect(
      evaluateTriggers({
        rules: [rule()],
        observation: { holdings: [...held, { productId: "p2", category: "protection" }] },
        asOf: ASOF,
        suppressWhenTargetHeld: false,
      }),
    ).toHaveLength(1);
  });

  it("restricts evaluation to the requested rule types", () => {
    const raised = evaluateTriggers({
      rules: [
        rule({ id: "r1", ruleType: "holding_based" }),
        rule({
          id: "r2",
          ruleType: "volume_pattern",
          sourceCategory: null,
          targetCategory: "premium",
        }),
      ],
      observation: { holdings: held, lanePatterns: [{ laneCode: "a", consignmentCount: 1, windowDays: 1 }] },
      asOf: ASOF,
      ruleTypes: ["volume_pattern"],
    });
    expect(raised).toHaveLength(1);
    expect(raised[0]?.ruleType).toBe("volume_pattern");
  });

  it("an empty ruleTypes list means all types", () => {
    const raised = evaluateTriggers({
      rules: [rule()],
      observation: { holdings: held },
      asOf: ASOF,
      ruleTypes: [],
    });
    expect(raised).toHaveLength(1);
  });

  it("orders by priority DESC, weight DESC, then ruleId ASC", () => {
    const raised = evaluateTriggers({
      rules: [
        rule({ id: "zzz", targetCategory: "t1", priority: 1, weightBps: 9999 }),
        rule({ id: "aaa", targetCategory: "t2", priority: 5, weightBps: 1 }),
      ],
      observation: { holdings: held },
      asOf: ASOF,
    });
    expect(raised.map((r) => r.ruleId)).toEqual(["aaa", "zzz"]);
  });

  it("breaks a full tie on ruleId so the order is total", () => {
    const raised = evaluateTriggers({
      rules: [
        rule({ id: "b", targetCategory: "t1", priority: 3, weightBps: 100 }),
        rule({ id: "a", targetCategory: "t2", priority: 3, weightBps: 100 }),
      ],
      observation: { holdings: held },
      asOf: ASOF,
    });
    expect(raised.map((r) => r.ruleId)).toEqual(["a", "b"]);
  });

  it("is order-independent", () => {
    const rules = [
      rule({ id: "a", targetCategory: "t1", priority: 2 }),
      rule({ id: "b", targetCategory: "t2", priority: 2 }),
    ];
    const forward = evaluateTriggers({ rules, observation: { holdings: held }, asOf: ASOF });
    const reversed = evaluateTriggers({
      rules: [...rules].reverse(),
      observation: { holdings: held },
      asOf: ASOF,
    });
    expect(reversed).toEqual(forward);
  });

  it("carries no subject-identifying data in the reason string", () => {
    const raised = evaluateTriggers({
      rules: [rule()],
      observation: { holdings: [{ productId: PRODUCT_A, category: "savings" }] },
      asOf: ASOF,
    });
    expect(raised[0]?.reason).not.toContain(PRODUCT_A);
    expect(raised[0]?.reason).not.toContain(SUBJECT);
  });
});

// ── triggersToCandidates ─────────────────────────────────────────────────────

describe("triggersToCandidates", () => {
  it("maps an empty list to an empty list", () => {
    expect(triggersToCandidates([])).toEqual([]);
  });

  it("converts weight bps to a 0..1 affinity signal", () => {
    const [candidate] = triggersToCandidates([
      {
        ruleId: "r1",
        ruleType: "holding_based",
        ruleName: "n",
        targetCategory: "protection",
        priority: 3,
        weightBps: 5000,
        reason: "r",
        evidence: {},
      },
    ]);
    expect(candidate?.signals.affinity).toBe(0.5);
    expect(candidate?.priority).toBe(3);
    expect(candidate?.actionType).toBe("trigger:holding_based");
  });

  it("clamps a weight above 10000 to affinity 1", () => {
    const [candidate] = triggersToCandidates([
      {
        ruleId: "r1",
        ruleType: "life_event",
        ruleName: "n",
        targetCategory: "t",
        priority: 0,
        weightBps: 99_999,
        reason: "r",
        evidence: {},
      },
    ]);
    expect(candidate?.signals.affinity).toBe(1);
  });

  it("maps zero weight to affinity 0", () => {
    const [candidate] = triggersToCandidates([
      {
        ruleId: "r1",
        ruleType: "volume_pattern",
        ruleName: "n",
        targetCategory: "t",
        priority: 0,
        weightBps: 0,
        reason: "r",
        evidence: {},
      },
    ]);
    expect(candidate?.signals.affinity).toBe(0);
  });
});

// ── validateConditions ───────────────────────────────────────────────────────

describe("validateConditions", () => {
  it("accepts an empty bag for every rule type", () => {
    for (const t of TRIGGER_RULE_TYPES) expect(validateConditions(t, {})).toBeNull();
  });

  it("accepts valid holding thresholds", () => {
    expect(
      validateConditions("holding_based", { minHoldingCount: 2, minHoldingValueMinor: "1000" }),
    ).toBeNull();
  });

  it("accepts valid life-event thresholds", () => {
    expect(
      validateConditions("life_event", { withinDays: 30, minAgeYears: 25, maxAgeYears: 60 }),
    ).toBeNull();
  });

  it("accepts valid volume thresholds", () => {
    expect(
      validateConditions("volume_pattern", {
        minVolume: 100,
        minDistinctLanes: 3,
        minValueMinor: "500000",
        minWindowDays: 30,
      }),
    ).toBeNull();
  });

  it("rejects a negative integer threshold", () => {
    expect(validateConditions("life_event", { withinDays: -1 })).toContain("non-negative");
  });

  it("rejects a fractional integer threshold", () => {
    expect(validateConditions("life_event", { withinDays: 1.5 })).toContain("non-negative");
  });

  it("rejects a non-numeric integer threshold", () => {
    const bag = { minVolume: "many" } as unknown as Parameters<typeof validateConditions>[1];
    expect(validateConditions("volume_pattern", bag)).toContain("non-negative");
  });

  it("rejects a malformed money threshold", () => {
    expect(validateConditions("holding_based", { minHoldingValueMinor: "1.5" })).toContain(
      "minor-unit string",
    );
  });

  it("rejects a numeric money threshold — money must be a string", () => {
    const bag = { minValueMinor: 1000 } as unknown as Parameters<typeof validateConditions>[1];
    expect(validateConditions("volume_pattern", bag)).toContain("minor-unit string");
  });

  it("rejects maxAgeYears below minAgeYears", () => {
    expect(validateConditions("life_event", { minAgeYears: 60, maxAgeYears: 25 })).toContain(
      "greater than or equal",
    );
  });

  it("accepts maxAgeYears equal to minAgeYears", () => {
    expect(validateConditions("life_event", { minAgeYears: 40, maxAgeYears: 40 })).toBeNull();
  });

  it("rejects a life-event threshold on a holding_based rule", () => {
    expect(validateConditions("holding_based", { withinDays: 30 })).toContain("holding_based");
  });

  it("rejects a volume threshold on a holding_based rule", () => {
    expect(validateConditions("holding_based", { minVolume: 10 })).toContain("holding_based");
  });

  it("rejects a holding threshold on a volume_pattern rule", () => {
    expect(validateConditions("volume_pattern", { minHoldingCount: 1 })).toContain("volume_pattern");
  });

  it("rejects a life-event threshold on a volume_pattern rule", () => {
    expect(validateConditions("volume_pattern", { withinDays: 1 })).toContain("volume_pattern");
  });
});

// ── validateRuleShape ────────────────────────────────────────────────────────

describe("validateRuleShape", () => {
  it("accepts a well-formed holding_based rule", () => {
    expect(
      validateRuleShape({
        ruleType: "holding_based",
        sourceCategory: "savings",
        targetCategory: "protection",
      }),
    ).toBeNull();
  });

  it("rejects a blank targetCategory", () => {
    expect(
      validateRuleShape({ ruleType: "life_event", targetCategory: "  ", eventCode: "e" }),
    ).toContain("targetCategory");
  });

  it("rejects holding_based without a sourceCategory", () => {
    expect(validateRuleShape({ ruleType: "holding_based", targetCategory: "protection" })).toContain(
      "sourceCategory",
    );
  });

  it("rejects holding_based whose source and target are the same", () => {
    expect(
      validateRuleShape({
        ruleType: "holding_based",
        sourceCategory: "savings",
        targetCategory: "SAVINGS",
      }),
    ).toContain("must differ");
  });

  it("rejects life_event without an eventCode", () => {
    expect(validateRuleShape({ ruleType: "life_event", targetCategory: "t" })).toContain("eventCode");
  });

  it("accepts volume_pattern with neither sourceCategory nor eventCode", () => {
    expect(validateRuleShape({ ruleType: "volume_pattern", targetCategory: "premium" })).toBeNull();
  });
});

// ── POST /v1/recommendations/trigger-rules ───────────────────────────────────

describe("POST /v1/recommendations/trigger-rules", () => {
  const url = "/v1/recommendations/trigger-rules";
  const body = {
    ruleType: "holding_based",
    name: "protection off savings base",
    sourceCategory: "savings",
    targetCategory: "protection",
    conditions: { minHoldingCount: 1 },
    priority: 10,
    weightBps: 6000,
  };

  it("202 — creates a holding_based rule (the IN-007 shape)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: body });
    expect(r.statusCode).toBe(202);
    expect(H.queuePublishMock).toHaveBeenCalledOnce();
        await app.close();
  });

  it("202 — creates a life_event rule (the FS-006 shape)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: auth(),
      payload: {
        ruleType: "life_event",
        name: "maturity window",
        targetCategory: "reinvestment",
        eventCode: "maturity_approaching",
        conditions: { withinDays: 30 },
      },
    });
    expect(r.statusCode).toBe(202);
    await app.close();
  });

  it("202 — creates a volume_pattern rule (the MP-011 shape)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: auth(),
      payload: {
        ruleType: "volume_pattern",
        name: "premium lead from lane spread",
        targetCategory: "premium_logistics",
        conditions: { minVolume: 500, minDistinctLanes: 3, minWindowDays: 30 },
      },
    });
    expect(r.statusCode).toBe(202);
    await app.close();
  });

  it("202 — defaults priority, weight, conditions and active", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: auth(),
      payload: { ruleType: "volume_pattern", name: "bare", targetCategory: "premium" },
    });
    expect(r.json().status).toBe("accepted");
    await app.close();
  });

  it("400 — unknown ruleType", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: auth(),
      payload: { ...body, ruleType: "posb_insurance" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — an unknown condition key is rejected (strict bag)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: auth(),
      payload: { ...body, conditions: { minPosbBalance: 10 } },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — a money threshold sent as a number", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: auth(),
      payload: { ...body, conditions: { minHoldingValueMinor: 1000 } },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — weightBps above 10000", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: auth(),
      payload: { ...body, weightBps: 10_001 },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("422 — holding_based without a sourceCategory", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: auth(),
      payload: { ruleType: "holding_based", name: "no source", targetCategory: "protection" },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("TRIGGER_RULE_INVALID");
    await app.close();
  });

  it("422 — life_event without an eventCode", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: auth(),
      payload: { ruleType: "life_event", name: "no code", targetCategory: "t" },
    });
    expect(r.statusCode).toBe(422);
    await app.close();
  });

  it("422 — a condition that does not belong to the rule type", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: auth(),
      payload: { ...body, conditions: { withinDays: 5 } },
    });
    expect(r.statusCode).toBe(422);
    await app.close();
  });

  it("422 — inverted effective window", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: auth(),
      payload: {
        ...body,
        effectiveFrom: "2026-07-01T00:00:00.000Z",
        effectiveTo: "2026-06-01T00:00:00.000Z",
      },
    });
    expect(r.statusCode).toBe(422);
    await app.close();
  });

  it("409 — duplicate rule name for the tenant", async () => {
    H.findByNameMock.mockResolvedValue(ruleRow());
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: body });
    expect(r.statusCode).toBe(409);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, payload: body });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — a reader cannot create configuration", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: readerAuth(), payload: body });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ── GET list / GET one ───────────────────────────────────────────────────────

describe("GET /v1/recommendations/trigger-rules", () => {
  const url = "/v1/recommendations/trigger-rules";

  it("200 — returns a page", async () => {
    H.listByTenantMock.mockResolvedValue({ rows: [ruleRow()], total: 1 });
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: readerAuth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().meta).toEqual({ page: 1, pageSize: 20, total: 1 });
    await app.close();
  });

  it("200 — empty result", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: readerAuth() });
    expect(r.json().data).toEqual([]);
    await app.close();
  });

  it("200 — filters by ruleType, targetCategory and active", async () => {
    const app = await buildApp();
    await app.inject({
      method: "GET",
      url: `${url}?ruleType=life_event&targetCategory=reinvestment&active=false`,
      headers: readerAuth(),
    });
    expect(H.listByTenantMock).toHaveBeenCalledWith(TENANT, 20, 0, {
      ruleType: "life_event",
      targetCategory: "reinvestment",
      active: false,
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

  it("400 — unknown ruleType filter", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `${url}?ruleType=posb`, headers: auth() });
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

describe("GET /v1/recommendations/trigger-rules/:id", () => {
  const url = `/v1/recommendations/trigger-rules/${RULE_ID}`;

  it("200 — returns the rule", async () => {
    H.cacheGetOrLoadMock.mockResolvedValue(ruleRow());
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: readerAuth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.id).toBe(RULE_ID);
    await app.close();
  });

  it("200 — tolerates ISO strings from a warm cache", async () => {
    H.cacheGetOrLoadMock.mockResolvedValue(
      ruleRow({
        effectiveFrom: "2026-06-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: readerAuth() });
    await app.close();
  });

  it("404 — unknown id", async () => {
    H.cacheGetOrLoadMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: readerAuth() });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("400 — non-uuid id", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/recommendations/trigger-rules/nope",
      headers: auth(),
    });
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

// ── PATCH / DELETE ───────────────────────────────────────────────────────────

describe("PATCH /v1/recommendations/trigger-rules/:id", () => {
  const url = `/v1/recommendations/trigger-rules/${RULE_ID}`;

  it("202 — accepts priority/weight update", async () => {
    H.findByIdMock.mockResolvedValue(ruleRow());
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url,
      headers: auth(),
      payload: { priority: 20, weightBps: 8000, version: 1 },
    });
    expect(r.statusCode).toBe(202);
    await app.close();
  });

  it("202 — accepts deactivate via active=false", async () => {
    H.findByIdMock.mockResolvedValue(ruleRow());
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url,
      headers: auth(),
      payload: { active: false, version: 1 },
    });
    expect(r.statusCode).toBe(202);
    const published = H.queuePublishMock.mock.calls.at(-1)?.[1] as { payload: { patch: { active: boolean } } };
    const patch = published.payload.patch;
    expect(patch.active).toBe(false);
    await app.close();
  });

  it("422 — clearing the sourceCategory of a holding_based rule", async () => {
    H.findByIdMock.mockResolvedValue(ruleRow());
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url,
      headers: auth(),
      payload: { sourceCategory: null, version: 1 },
    });
    expect(r.statusCode).toBe(422);
    await app.close();
  });

  it("422 — a merged condition bag invalid for the STORED rule type", async () => {
    H.findByIdMock.mockResolvedValue(ruleRow());
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url,
      headers: auth(),
      payload: { conditions: { withinDays: 10 }, version: 1 },
    });
    expect(r.statusCode).toBe(422);
    await app.close();
  });

  it("422 — patching the target to equal the stored source", async () => {
    H.findByIdMock.mockResolvedValue(ruleRow());
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url,
      headers: auth(),
      payload: { targetCategory: "savings", version: 1 },
    });
    expect(r.statusCode).toBe(422);
    await app.close();
  });

  it("422 — a stored rule with an unknown ruleType cannot be patched", async () => {
    H.findByIdMock.mockResolvedValue(ruleRow({ ruleType: "legacy_thing" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url,
      headers: auth(),
      payload: { priority: 1, version: 1 },
    });
    expect(r.statusCode).toBe(422);
    await app.close();
  });

  it("409 — version conflict", async () => {
    H.findByIdMock.mockResolvedValue(ruleRow());
    H.updateMock.mockResolvedValue(false);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url,
      headers: auth(),
      payload: { priority: 1, version: 99 },
    });
    expect(r.statusCode).toBe(409);
    await app.close();
  });

  it("404 — unknown id", async () => {
    H.findByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url,
      headers: auth(),
      payload: { priority: 1, version: 1 },
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("400 — missing version", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url, headers: auth(), payload: { priority: 1 } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url, payload: { priority: 1, version: 1 } });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — a reader cannot patch", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url,
      headers: readerAuth(),
      payload: { priority: 1, version: 1 },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("DELETE /v1/recommendations/trigger-rules/:id", () => {
  const url = `/v1/recommendations/trigger-rules/${RULE_ID}`;

  it("202 — accepts deactivate", async () => {
    H.findByIdMock.mockResolvedValue(ruleRow());
    const app = await buildApp();
    const r = await app.inject({ method: "DELETE", url, headers: auth() });
    expect(r.statusCode).toBe(202);
    expect(H.queuePublishMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("404 — unknown id", async () => {
    H.findByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "DELETE", url, headers: auth() });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("202 — accepts deactivate when row exists", async () => {
    H.findByIdMock.mockResolvedValue(ruleRow());
    H.deactivateMock.mockResolvedValue(false);
    const app = await buildApp();
    const r = await app.inject({ method: "DELETE", url, headers: auth() });
    expect(r.statusCode).toBe(202);
    await app.close();
  });

  it("400 — non-uuid id", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "DELETE",
      url: "/v1/recommendations/trigger-rules/nope",
      headers: auth(),
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "DELETE", url });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — a reader cannot deactivate", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "DELETE", url, headers: readerAuth() });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ── POST /v1/recommendations/trigger-rules/evaluate ──────────────────────────

describe("POST /v1/recommendations/trigger-rules/evaluate", () => {
  const url = "/v1/recommendations/trigger-rules/evaluate";

  it("200 — raises a holding_based recommendation and scores it", async () => {
    H.listEvaluableMock.mockResolvedValue([ruleRow()]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: readerAuth(),
      payload: {
        subjectId: SUBJECT,
        holdings: [{ productId: PRODUCT_A, category: "savings", valueMinor: "500000" }],
      },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    expect(r.json().data[0].targetCategory).toBe("protection");
    // Scored through the existing nba ranking engine: weight 5000 bps → affinity 0.5.
    expect(r.json().data[0].score).toBeGreaterThan(0);
    await app.close();
  });

  it("200 — empty result when nothing fires", async () => {
    H.listEvaluableMock.mockResolvedValue([ruleRow()]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: readerAuth(),
      payload: { subjectId: SUBJECT, holdings: [] },
    });
    expect(r.json().data).toEqual([]);
    expect(r.json().meta.total).toBe(0);
    await app.close();
  });

  it("200 — no configured rules means nothing raised", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: readerAuth(),
      payload: { subjectId: SUBJECT },
    });
    expect(r.json().meta.ruleCount).toBe(0);
    expect(r.json().data).toEqual([]);
    await app.close();
  });

  it("200 — skips a stored rule whose ruleType is unknown to this version", async () => {
    H.listEvaluableMock.mockResolvedValue([ruleRow({ ruleType: "legacy_thing" })]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: readerAuth(),
      payload: { subjectId: SUBJECT, holdings: [{ productId: PRODUCT_A, category: "savings" }] },
    });
    expect(r.json().meta.ruleCount).toBe(0);
    await app.close();
  });

  it("200 — raises a life_event recommendation", async () => {
    H.listEvaluableMock.mockResolvedValue([
      ruleRow({
        ruleType: "life_event",
        sourceCategory: null,
        eventCode: "maturity_approaching",
        targetCategory: "reinvestment",
        conditions: { withinDays: 30 },
      }),
    ]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: readerAuth(),
      payload: {
        subjectId: SUBJECT,
        asOf: "2026-06-15T00:00:00.000Z",
        lifeEvents: [
          { eventCode: "maturity_approaching", occurredAt: "2026-06-20T00:00:00.000Z" },
        ],
      },
    });
    expect(r.json().data[0].ruleType).toBe("life_event");
    expect(r.json().data[0].evidence.direction).toBe("upcoming");
    await app.close();
  });

  it("200 — raises a volume_pattern recommendation", async () => {
    H.listEvaluableMock.mockResolvedValue([
      ruleRow({
        ruleType: "volume_pattern",
        sourceCategory: null,
        targetCategory: "premium_logistics",
        conditions: { minVolume: 100, minDistinctLanes: 2 },
      }),
    ]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: readerAuth(),
      payload: {
        subjectId: SUBJECT,
        lanePatterns: [
          { laneCode: "l1", consignmentCount: 60, windowDays: 30 },
          { laneCode: "l2", consignmentCount: 60, windowDays: 30 },
        ],
      },
    });
    expect(r.json().data[0].targetCategory).toBe("premium_logistics");
    expect(r.json().data[0].evidence.distinctLanes).toBe(2);
    await app.close();
  });

  it("200 — forwards the ruleTypes filter to the query", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url,
      headers: readerAuth(),
      payload: { subjectId: SUBJECT, ruleTypes: ["life_event"] },
    });
    expect(H.listEvaluableMock.mock.calls[0]?.[3]).toEqual(["life_event"]);
    await app.close();
  });

  it("200 — echoes asOf and defaults it to now", async () => {
    const before = Date.now();
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: readerAuth(),
      payload: { subjectId: SUBJECT },
    });
    expect(new Date(r.json().meta.asOf).getTime()).toBeGreaterThanOrEqual(before);
    await app.close();
  });

  it("200 — respects limit while reporting the full total", async () => {
    H.listEvaluableMock.mockResolvedValue([
      ruleRow({ id: "r1", name: "a", targetCategory: "t1", priority: 5 }),
      ruleRow({ id: "r2", name: "b", targetCategory: "t2", priority: 4 }),
    ]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: readerAuth(),
      payload: { subjectId: SUBJECT, holdings: [{ productId: PRODUCT_A, category: "savings" }], limit: 1 },
    });
    expect(r.json().data).toHaveLength(1);
    expect(r.json().meta.total).toBe(2);
    await app.close();
  });

  it("writes nothing — evaluation is a read", async () => {
    H.listEvaluableMock.mockResolvedValue([ruleRow()]);
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url,
      headers: readerAuth(),
      payload: { subjectId: SUBJECT, holdings: [{ productId: PRODUCT_A, category: "savings" }] },
    });
    expect(H.insertMock).not.toHaveBeenCalled();
    expect(H.updateMock).not.toHaveBeenCalled();
    expect(H.queuePublishMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("400 — non-uuid subjectId", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: readerAuth(),
      payload: { subjectId: "nope" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — a holding value sent as a number", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: readerAuth(),
      payload: {
        subjectId: SUBJECT,
        holdings: [{ productId: PRODUCT_A, category: "savings", valueMinor: 500 }],
      },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — an unknown key in a holding (strict)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: readerAuth(),
      payload: {
        subjectId: SUBJECT,
        holdings: [{ productId: PRODUCT_A, category: "savings", posbBalance: 1 }],
      },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — windowDays below 1", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: readerAuth(),
      payload: {
        subjectId: SUBJECT,
        lanePatterns: [{ laneCode: "l1", consignmentCount: 1, windowDays: 0 }],
      },
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
      payload: { subjectId: SUBJECT, limit: 500 },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, payload: { subjectId: SUBJECT } });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: strangerAuth(),
      payload: { subjectId: SUBJECT },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
