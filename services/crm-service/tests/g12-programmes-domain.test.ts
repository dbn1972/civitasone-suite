/**
 * G12 — programme domain unit tests (Spec §25.7, Journey J6).
 *
 * Pure functions only: no database, no queue, no cache. Everything a route or consumer
 * decides about a programme is decided here, so this file is where the branches are
 * actually exercised — the HTTP tests then only need to prove the wiring.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_CURRENCY,
  DEFAULT_PRODUCT_LINE,
  HEALTH_METRIC_KEYS,
  HEALTH_THRESHOLDS,
  INITIAL_STATUS,
  MAX_COVERAGE_ENTRIES,
  METRIC_KINDS,
  PROGRAMME_STATUSES,
  acceptsMetrics,
  allowedNextStatuses,
  canTransition,
  classifyMetric,
  coverageEntryCount,
  healthBand,
  isIsoDate,
  isMetricKind,
  isOrderedRange,
  isProgrammeStatus,
  isTerminalStatus,
  isValidDecimal,
  isValidMinorUnits,
  isValidProgrammeCode,
  normaliseCoverageScope,
  normaliseMetricValue,
  normaliseProgrammeCode,
  summariseExecutionHealth,
  type MetricSample,
} from "../src/modules/programmes/domain.js";

describe("programme lifecycle", () => {
  it("registers in draft — registering is not activating", () => {
    expect(INITIAL_STATUS).toBe("draft");
    expect(DEFAULT_PRODUCT_LINE).toBe("government");
    expect(PROGRAMME_STATUSES).toEqual(["draft", "active", "suspended", "closed"]);
  });

  it("walks draft → active → suspended → active", () => {
    expect(canTransition("draft", "active")).toBe(true);
    expect(canTransition("active", "suspended")).toBe(true);
    expect(canTransition("suspended", "active")).toBe(true);
  });

  it("lets every live status close, because a programme can end at any point", () => {
    for (const status of ["draft", "active", "suspended"] as const) {
      expect(canTransition(status, "closed")).toBe(true);
    }
  });

  it("refuses to skip activation or resurrect a closed programme", () => {
    expect(canTransition("draft", "suspended")).toBe(false);
    expect(canTransition("closed", "active")).toBe(false);
    expect(canTransition("closed", "draft")).toBe(false);
    // A programme cannot transition to the status it is already in.
    expect(canTransition("active", "active")).toBe(false);
  });

  it("treats closed as terminal and nothing else", () => {
    expect(isTerminalStatus("closed")).toBe(true);
    expect(allowedNextStatuses("closed")).toEqual([]);
    for (const status of ["draft", "active", "suspended"] as const) {
      expect(isTerminalStatus(status)).toBe(false);
      expect(allowedNextStatuses(status).length).toBeGreaterThan(0);
    }
  });

  it("recognises only the four defined statuses", () => {
    for (const status of PROGRAMME_STATUSES) expect(isProgrammeStatus(status)).toBe(true);
    expect(isProgrammeStatus("cancelled")).toBe(false);
    expect(isProgrammeStatus("")).toBe(false);
  });

  it("accepts metrics for anything except a draft", () => {
    expect(acceptsMetrics("draft")).toBe(false);
    expect(acceptsMetrics("active")).toBe(true);
    // Suspended and closed still accept metrics: a suspension does not erase the delivery
    // that already happened, and a closed programme is still reported on retrospectively.
    expect(acceptsMetrics("suspended")).toBe(true);
    expect(acceptsMetrics("closed")).toBe(true);
  });
});

describe("programme code", () => {
  it("uppercases and trims so one tenant cannot register two spellings of one code", () => {
    expect(normaliseProgrammeCode("  pmay-u-2026 ")).toBe("PMAY-U-2026");
    expect(normaliseProgrammeCode("PMAY-U-2026")).toBe("PMAY-U-2026");
  });

  it("accepts the shapes real programme codes take", () => {
    for (const code of ["PMAY-U-2026", "nrega_2026", "SBM/URBAN/2026", "ABC"]) {
      expect(isValidProgrammeCode(code), code).toBe(true);
    }
  });

  it("rejects codes that would break downstream reporting", () => {
    for (const code of [
      "AB", // too short to be meaningful
      "-LEADING-DASH", // must start alphanumeric
      "HAS SPACE",
      "HAS.DOT",
      "",
      "A".repeat(65), // over the 64-char column
    ]) {
      expect(isValidProgrammeCode(code), code).toBe(false);
    }
  });
});

describe("dates", () => {
  it("accepts real ISO calendar dates", () => {
    expect(isIsoDate("2026-04-01")).toBe(true);
    expect(isIsoDate("2024-02-29")).toBe(true);
  });

  it("rejects malformed and non-existent dates", () => {
    expect(isIsoDate("2026-4-1")).toBe(false);
    expect(isIsoDate("01-04-2026")).toBe(false);
    // Would silently roll into March if it were passed to Date.
    expect(isIsoDate("2026-02-31")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("")).toBe(false);
  });

  it("treats an open-ended programme as a valid range", () => {
    expect(isOrderedRange(null, null)).toBe(true);
    expect(isOrderedRange("2026-04-01", null)).toBe(true);
    expect(isOrderedRange(null, "2027-03-31")).toBe(true);
    expect(isOrderedRange(undefined, undefined)).toBe(true);
  });

  it("rejects an end before a start, and allows a single-day programme", () => {
    expect(isOrderedRange("2026-04-01", "2027-03-31")).toBe(true);
    expect(isOrderedRange("2026-04-01", "2026-04-01")).toBe(true);
    expect(isOrderedRange("2027-03-31", "2026-04-01")).toBe(false);
  });
});

describe("coverage scope", () => {
  it("trims, drops blanks, de-duplicates and sorts", () => {
    expect(
      normaliseCoverageScope({
        regions: [" MH ", "MH", "GJ", "  "],
        districts: ["Pune", "Nashik", "Pune"],
      }),
    ).toEqual({ regions: ["GJ", "MH"], districts: ["Nashik", "Pune"] });
  });

  it("omits an empty list rather than storing an empty array", () => {
    expect(normaliseCoverageScope({ regions: [], districts: ["Pune"] })).toEqual({
      districts: ["Pune"],
    });
    expect(normaliseCoverageScope({})).toEqual({});
    expect(normaliseCoverageScope(undefined)).toEqual({});
  });

  it("counts the entries a programme actually covers", () => {
    expect(coverageEntryCount({ regions: ["MH", "MH"], districts: ["Pune"] })).toBe(2);
    expect(coverageEntryCount(undefined)).toBe(0);
    expect(MAX_COVERAGE_ENTRIES).toBe(500);
  });
});

describe("metric classification", () => {
  it("knows the declared kinds", () => {
    expect(METRIC_KINDS).toEqual(["money", "count", "ratio"]);
    for (const kind of METRIC_KINDS) expect(isMetricKind(kind)).toBe(true);
    expect(isMetricKind("bigint")).toBe(false);
  });

  it("classifies anything that reads as money as money", () => {
    for (const key of ["revenue", "gross_revenue", "programme_cost", "penalty_amount", "invoiced_value"]) {
      expect(classifyMetric(key), key).toBe("money");
    }
  });

  it("classifies ratios and rates as ratios", () => {
    for (const key of ["coverage_ratio", "exception_rate", "grievance_rate", "uptime_pct"]) {
      expect(classifyMetric(key), key).toBe("ratio");
    }
  });

  it("falls back to count for plain volumes", () => {
    expect(classifyMetric("volume")).toBe("count");
    expect(classifyMetric("beneficiaries_enrolled")).toBe("count");
    expect(classifyMetric("VOLUME")).toBe("count");
  });
});

describe("metric value normalisation", () => {
  it("takes money as an integer string of minor units and defaults the currency", () => {
    const result = normaliseMetricValue({ metricKey: "revenue", value: "123456789012345678" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      metricKind: "money",
      valueMinor: 123456789012345678n,
      valueNumeric: null,
      currency: DEFAULT_CURRENCY,
    });
  });

  it("keeps a value above 2^53 minor units exact", () => {
    const beyondDouble = "9007199254740993"; // 2^53 + 1
    const result = normaliseMetricValue({ metricKey: "revenue", value: beyondDouble });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.valueMinor?.toString()).toBe(beyondDouble);
  });

  it("allows a negative monetary metric — a credit note is real", () => {
    const result = normaliseMetricValue({ metricKey: "revenue", value: "-5000" });
    expect(result.ok).toBe(true);
  });

  it("refuses a fractional or non-numeric money value", () => {
    for (const value of ["1234.56", "1,234", "1e6", "abc", ""]) {
      const result = normaliseMetricValue({ metricKey: "revenue", value });
      expect(result.ok, value).toBe(false);
      if (!result.ok) expect(result.code).toBe("INVALID_MONEY_VALUE");
    }
  });

  it("uppercases a supplied currency and refuses a non-ISO one", () => {
    const ok = normaliseMetricValue({ metricKey: "revenue", value: "100", currency: "usd" });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.currency).toBe("USD");

    const bad = normaliseMetricValue({ metricKey: "revenue", value: "100", currency: "RUPEE" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe("INVALID_CURRENCY");
  });

  it("keeps counts and ratios as exact decimal strings with no currency", () => {
    const count = normaliseMetricValue({ metricKey: "volume", value: "18420" });
    expect(count.ok).toBe(true);
    if (count.ok) {
      expect(count.value).toEqual({
        metricKind: "count",
        valueMinor: null,
        valueNumeric: "18420",
        currency: null,
      });
    }

    const ratio = normaliseMetricValue({ metricKey: "coverage_ratio", value: "0.875432" });
    expect(ratio.ok).toBe(true);
    if (ratio.ok) expect(ratio.value.valueNumeric).toBe("0.875432");
  });

  it("refuses a currency on a non-monetary metric rather than silently dropping it", () => {
    const result = normaliseMetricValue({
      metricKey: "volume",
      value: "10",
      currency: "INR",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("CURRENCY_NOT_APPLICABLE");
  });

  it("refuses more precision than numeric(20,6) can hold", () => {
    const result = normaliseMetricValue({ metricKey: "coverage_ratio", value: "0.1234567" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_NUMERIC_VALUE");
  });

  it("holds a ratio to 0..1 so a percentage cannot be filed as a fraction", () => {
    for (const value of ["1.5", "87", "-0.1"]) {
      const result = normaliseMetricValue({ metricKey: "coverage_ratio", value });
      expect(result.ok, value).toBe(false);
      if (!result.ok) expect(result.code).toBe("RATIO_OUT_OF_RANGE");
    }
    expect(normaliseMetricValue({ metricKey: "coverage_ratio", value: "0" }).ok).toBe(true);
    expect(normaliseMetricValue({ metricKey: "coverage_ratio", value: "1" }).ok).toBe(true);
  });

  it("refuses a negative count — you cannot deliver minus three services", () => {
    const result = normaliseMetricValue({ metricKey: "volume", value: "-3" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NEGATIVE_COUNT");
  });

  it("honours an explicit kind over the keyword guess", () => {
    // A tenant whose "settlement_value" is a headcount, not money.
    const result = normaliseMetricValue({
      metricKey: "settlement_value",
      metricKind: "count",
      value: "12",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.metricKind).toBe("count");
  });

  it("validates the raw formats independently", () => {
    expect(isValidMinorUnits(" 100 ")).toBe(true);
    expect(isValidMinorUnits("100.5")).toBe(false);
    expect(isValidDecimal("-12.5")).toBe(true);
    expect(isValidDecimal("12.")).toBe(false);
  });
});

describe("execution health", () => {
  function sample(metricKey: string, value: string, money = false): MetricSample {
    return money
      ? { metricKey, metricKind: "money", valueMinor: value, valueNumeric: null }
      : { metricKey, metricKind: "count", valueMinor: null, valueNumeric: value };
  }

  it("is unknown until something is reported", () => {
    const health = summariseExecutionHealth([]);
    expect(health.band).toBe("unknown");
    expect(health.metricCount).toBe(0);
    expect(health.volume).toBe(0);
    expect(health.revenueMinor).toBe("0");
    expect(health.coverageRatio).toBeNull();
  });

  it("sums volume, averages the ratios and sums revenue exactly", () => {
    const health = summariseExecutionHealth([
      sample(HEALTH_METRIC_KEYS.volume, "1000"),
      sample(HEALTH_METRIC_KEYS.volume, "500"),
      sample(HEALTH_METRIC_KEYS.coverage, "0.9"),
      sample(HEALTH_METRIC_KEYS.coverage, "1"),
      sample(HEALTH_METRIC_KEYS.exception, "0.01"),
      sample(HEALTH_METRIC_KEYS.grievance, "0.01"),
      sample(HEALTH_METRIC_KEYS.revenue, "9007199254740993", true),
      sample(HEALTH_METRIC_KEYS.revenue, "1", true),
    ]);
    expect(health.volume).toBe(1500);
    expect(health.coverageRatio).toBeCloseTo(0.95, 10);
    // BigInt arithmetic: a Number sum would have produced ...994 or worse.
    expect(health.revenueMinor).toBe("9007199254740994");
    expect(health.band).toBe("healthy");
    expect(health.metricCount).toBe(8);
  });

  it("ignores metric keys it does not recognise, so a tenant cannot redefine the band", () => {
    const health = summariseExecutionHealth([
      sample("tenant_specific_thing", "0"),
      sample(HEALTH_METRIC_KEYS.coverage, "0.99"),
    ]);
    expect(health.band).toBe("healthy");
    expect(health.metricCount).toBe(2);
    expect(health.volume).toBe(0);
  });

  it("skips a malformed revenue string instead of throwing mid-report", () => {
    const health = summariseExecutionHealth([
      { metricKey: HEALTH_METRIC_KEYS.revenue, metricKind: "money", valueMinor: "not-a-number", valueNumeric: null },
      sample(HEALTH_METRIC_KEYS.revenue, "250", true),
    ]);
    expect(health.revenueMinor).toBe("250");
  });

  it("ignores a null-valued sample on every branch", () => {
    for (const key of Object.values(HEALTH_METRIC_KEYS)) {
      const health = summariseExecutionHealth([
        { metricKey: key, metricKind: "count", valueMinor: null, valueNumeric: null },
      ]);
      expect(health.metricCount).toBe(1);
      expect(health.volume).toBe(0);
      expect(health.coverageRatio).toBeNull();
      expect(health.revenueMinor).toBe("0");
    }
  });

  it("drops to watch when any single signal slips", () => {
    expect(healthBand({ coverageRatio: 0.85, exceptionRate: null, grievanceRate: null })).toBe("watch");
    expect(healthBand({ coverageRatio: null, exceptionRate: 0.08, grievanceRate: null })).toBe("watch");
    expect(healthBand({ coverageRatio: null, exceptionRate: null, grievanceRate: 0.03 })).toBe("watch");
  });

  it("drops to at_risk when any single signal breaches, however good the others are", () => {
    expect(healthBand({ coverageRatio: 0.5, exceptionRate: 0, grievanceRate: 0 })).toBe("at_risk");
    expect(healthBand({ coverageRatio: 1, exceptionRate: 0.2, grievanceRate: 0 })).toBe("at_risk");
    expect(healthBand({ coverageRatio: 1, exceptionRate: 0, grievanceRate: 0.5 })).toBe("at_risk");
  });

  it("is healthy exactly at the watch thresholds, not just beyond them", () => {
    const t = HEALTH_THRESHOLDS;
    expect(
      healthBand({
        coverageRatio: t.coverageWatch,
        exceptionRate: t.exceptionWatch,
        grievanceRate: t.grievanceWatch,
      }),
    ).toBe("healthy");
  });

  it("reports unknown when every signal is absent even though other metrics exist", () => {
    expect(healthBand({ coverageRatio: null, exceptionRate: null, grievanceRate: null })).toBe("unknown");
  });
});
