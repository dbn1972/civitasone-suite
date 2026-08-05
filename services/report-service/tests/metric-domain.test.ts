/**
 * metrics/domain.ts unit tests — every governance branch, no database.
 *
 * Covers: status transitions (valid + invalid), canonical immutability,
 * the ratio/denominator rule, dimension validation (empty, max, duplicate,
 * over-long, non-identifier, non-string) and source-key allowlist rejection.
 */
import { describe, it, expect } from "vitest";
import {
  AGGREGATIONS,
  ALLOWED_TRANSITIONS,
  CANONICAL_IMMUTABLE_FIELDS,
  GOVERNANCES,
  MAX_DIMENSIONS,
  PERIODS,
  PLATFORM_TENANT_ID,
  STATUSES,
  TENANT_OVERRIDABLE_FIELDS,
  canTransition,
  checkPatchAllowed,
  isAggregation,
  isGovernance,
  isPeriod,
  isStatus,
  isValidMetricKey,
  isValidSourceKey,
  nextVersionDraft,
  requiresDenominator,
  statusTransitionPatch,
  validateDenominatorRule,
  validateDimensions,
  validateMetricDefinition,
  validateStatusTransition,
  type VersionableRow,
} from "../src/modules/metrics/domain.js";

const TENANT = "cccccccc-3333-4000-8000-0000000000c4";

const validInput = {
  metricKey: "crm.lead_to_agreement_cycle_days",
  aggregation: "avg",
  numeratorSource: "crm.lead_to_agreement_cycle",
  denominatorSource: null,
  dimensions: ["region", "channel"],
  period: "monthly",
  governance: "tenant",
};

// ─── Enum guards ─────────────────────────────────────────────────────────────

describe("enum guards", () => {
  it("accepts every declared aggregation, period, status and governance", () => {
    for (const a of AGGREGATIONS) expect(isAggregation(a)).toBe(true);
    for (const p of PERIODS) expect(isPeriod(p)).toBe(true);
    for (const s of STATUSES) expect(isStatus(s)).toBe(true);
    for (const g of GOVERNANCES) expect(isGovernance(g)).toBe(true);
  });

  it("rejects unknown values and non-strings", () => {
    expect(isAggregation("median")).toBe(false);
    expect(isPeriod("fortnightly")).toBe(false);
    expect(isStatus("archived")).toBe(false);
    expect(isGovernance("platform")).toBe(false);
    expect(isAggregation(42)).toBe(false);
    expect(isPeriod(null)).toBe(false);
    expect(isStatus(undefined)).toBe(false);
    expect(isGovernance({})).toBe(false);
  });
});

// ─── Source-key allowlist (SQL-injection surface) ────────────────────────────

describe("source key allowlist", () => {
  it("accepts lowercase dotted identifiers", () => {
    expect(isValidSourceKey("crm.contacts_converted")).toBe(true);
    expect(isValidSourceKey("service.interactions_total")).toBe(true);
    expect(isValidSourceKey("abc")).toBe(true);
  });

  it("rejects anything that could carry SQL", () => {
    for (const bad of [
      "crm.contacts; DROP TABLE reports.kpis",
      "SELECT * FROM reports.kpis",
      "crm.contacts--comment",
      "crm.contacts'",
      'crm."contacts"',
      "crm.contacts(1)",
      "crm contacts",
      "crm.contacts OR 1=1",
      "1crm.contacts",
      ".leading_dot",
      "CRM.CONTACTS",
      "ab",
      "",
    ]) {
      expect(isValidSourceKey(bad), bad).toBe(false);
    }
  });

  it("rejects non-strings and over-long keys", () => {
    expect(isValidSourceKey(undefined)).toBe(false);
    expect(isValidSourceKey(123)).toBe(false);
    expect(isValidSourceKey(`a${"b".repeat(200)}`)).toBe(false);
  });

  it("caps metric keys at the column width", () => {
    expect(isValidMetricKey("crm.retention_90d_rate")).toBe(true);
    expect(isValidMetricKey(`a${"b".repeat(96)}`)).toBe(false);
    expect(isValidMetricKey("Crm.Retention")).toBe(false);
  });
});

// ─── ratio / denominator rule ────────────────────────────────────────────────

describe("ratio/denominator rule", () => {
  it("flags ratio and percent as needing a denominator", () => {
    expect(requiresDenominator("ratio")).toBe(true);
    expect(requiresDenominator("percent")).toBe(true);
    expect(requiresDenominator("avg")).toBe(false);
    expect(requiresDenominator("count_distinct")).toBe(false);
  });

  it("rejects ratio without a denominator", () => {
    const err = validateDenominatorRule({ aggregation: "ratio" });
    expect(err?.field).toBe("denominatorSource");
    expect(err?.message).toContain("required");
  });

  it("rejects percent with an empty-string denominator", () => {
    expect(validateDenominatorRule({ aggregation: "percent", denominatorSource: "" })).not.toBeNull();
  });

  it("rejects a denominator on a non-ratio aggregation", () => {
    const err = validateDenominatorRule({ aggregation: "sum", denominatorSource: "crm.total" });
    expect(err?.message).toContain("must be null");
  });

  it("accepts the two legal shapes", () => {
    expect(
      validateDenominatorRule({ aggregation: "ratio", denominatorSource: "crm.total" }),
    ).toBeNull();
    expect(validateDenominatorRule({ aggregation: "avg", denominatorSource: null })).toBeNull();
  });
});

// ─── dimensions ──────────────────────────────────────────────────────────────

describe("validateDimensions", () => {
  it("treats undefined and an empty list as valid", () => {
    expect(validateDimensions(undefined)).toBeNull();
    expect(validateDimensions([])).toBeNull();
  });

  it("accepts up to the maximum", () => {
    const dims = Array.from({ length: MAX_DIMENSIONS }, (_, i) => `dim_${i}`);
    expect(validateDimensions(dims)).toBeNull();
  });

  it("rejects more than the maximum", () => {
    const dims = Array.from({ length: MAX_DIMENSIONS + 1 }, (_, i) => `dim_${i}`);
    expect(validateDimensions(dims)?.message).toContain(`at most ${MAX_DIMENSIONS}`);
  });

  it("rejects duplicates", () => {
    expect(validateDimensions(["region", "region"])?.message).toContain("duplicate");
  });

  it("rejects an empty dimension name", () => {
    expect(validateDimensions([""])?.message).toContain("must not be empty");
  });

  it("rejects an over-long dimension name", () => {
    expect(validateDimensions(["x".repeat(65)])?.message).toContain("at most 64");
  });

  it("rejects a non-identifier dimension name", () => {
    expect(validateDimensions(["region-code"])?.message).toContain("not a valid identifier");
    expect(validateDimensions(["1region"])?.message).toContain("not a valid identifier");
  });

  it("rejects non-string entries", () => {
    expect(validateDimensions([7])?.message).toContain("must be a string");
  });
});

// ─── full definition validation ──────────────────────────────────────────────

describe("validateMetricDefinition", () => {
  it("returns no errors for a valid definition", () => {
    expect(validateMetricDefinition(validInput)).toEqual([]);
  });

  it("accepts a valid ratio definition", () => {
    expect(
      validateMetricDefinition({
        ...validInput,
        metricKey: "crm.retention_90d_rate",
        aggregation: "ratio",
        numeratorSource: "crm.retained",
        denominatorSource: "crm.eligible",
        period: "rolling_90d",
      }),
    ).toEqual([]);
  });

  it("collects every violation at once", () => {
    const errors = validateMetricDefinition({
      metricKey: "Bad Key",
      aggregation: "median",
      numeratorSource: "SELECT 1",
      denominatorSource: "also bad",
      dimensions: ["region", "region"],
      period: "fortnightly",
      governance: "platform",
    });
    const fields = errors.map((e) => e.field);
    expect(fields).toContain("metricKey");
    expect(fields).toContain("aggregation");
    expect(fields).toContain("period");
    expect(fields).toContain("governance");
    expect(fields).toContain("numeratorSource");
    expect(fields).toContain("denominatorSource");
    expect(fields).toContain("dimensions");
  });

  it("omits the governance error when governance is not supplied", () => {
    const { governance: _governance, ...rest } = validInput;
    expect(validateMetricDefinition(rest)).toEqual([]);
  });
});

// ─── status transitions ──────────────────────────────────────────────────────

describe("status transitions", () => {
  it("allows draft → published and published → deprecated", () => {
    expect(canTransition("draft", "published")).toBe(true);
    expect(canTransition("published", "deprecated")).toBe(true);
    expect(validateStatusTransition("draft", "published")).toBeNull();
    expect(validateStatusTransition("published", "deprecated")).toBeNull();
  });

  it("refuses every backward or skipping transition", () => {
    for (const [from, to] of [
      ["published", "draft"],
      ["deprecated", "published"],
      ["deprecated", "draft"],
      ["draft", "deprecated"],
      ["draft", "draft"],
      ["published", "published"],
      ["deprecated", "deprecated"],
    ] as const) {
      expect(canTransition(from, to), `${from}->${to}`).toBe(false);
      expect(validateStatusTransition(from, to)).toContain(`from '${from}' to '${to}'`);
    }
  });

  it("refuses unknown statuses on either side", () => {
    expect(canTransition("archived", "published")).toBe(false);
    expect(canTransition("draft", "retired")).toBe(false);
  });

  it("leaves deprecated as a terminal state", () => {
    expect(ALLOWED_TRANSITIONS.deprecated).toEqual([]);
  });

  it("stamps the matching timestamp column for a transition", () => {
    const at = new Date("2026-07-10T00:00:00.000Z");
    expect(statusTransitionPatch("published", at)).toEqual({ status: "published", publishedAt: at });
    expect(statusTransitionPatch("deprecated", at)).toEqual({
      status: "deprecated",
      deprecatedAt: at,
    });
    expect(statusTransitionPatch("draft", at)).toEqual({ status: "draft" });
  });
});

// ─── governance gate on PATCH ────────────────────────────────────────────────

describe("checkPatchAllowed", () => {
  const draftTenant = { governance: "tenant", status: "draft", tenantId: TENANT };
  const publishedTenant = { governance: "tenant", status: "published", tenantId: TENANT };
  const publishedCanonical = { governance: "canonical", status: "published", tenantId: TENANT };
  const platformCanonical = {
    governance: "canonical",
    status: "published",
    tenantId: PLATFORM_TENANT_ID,
  };

  it("permits an empty patch on anything", () => {
    expect(checkPatchAllowed(platformCanonical, [], TENANT)).toBeNull();
  });

  it("permits any field on a draft", () => {
    expect(checkPatchAllowed(draftTenant, ["metricKey", "unit", "aggregation"], TENANT)).toBeNull();
  });

  it("permits the overridable fields on a published definition", () => {
    expect(checkPatchAllowed(publishedTenant, [...TENANT_OVERRIDABLE_FIELDS], TENANT)).toBeNull();
    expect(checkPatchAllowed(publishedCanonical, [...TENANT_OVERRIDABLE_FIELDS], TENANT)).toBeNull();
  });

  it("returns CANONICAL_IMMUTABLE for each frozen field of a published canonical row", () => {
    for (const field of CANONICAL_IMMUTABLE_FIELDS) {
      const rejection = checkPatchAllowed(publishedCanonical, [field], TENANT);
      expect(rejection?.code, field).toBe("CANONICAL_IMMUTABLE");
      expect(rejection?.fields).toEqual([field]);
    }
  });

  it("returns CANONICAL_IMMUTABLE for a platform-owned row even for overridable fields", () => {
    const rejection = checkPatchAllowed(platformCanonical, ["targetValue"], TENANT);
    expect(rejection?.code).toBe("CANONICAL_IMMUTABLE");
    expect(rejection?.message).toContain("read-only");
  });

  it("returns PUBLISHED_IMMUTABLE for a published tenant definition", () => {
    const rejection = checkPatchAllowed(publishedTenant, ["unit", "description"], TENANT);
    expect(rejection?.code).toBe("PUBLISHED_IMMUTABLE");
    expect(rejection?.fields).toEqual(["unit"]);
  });

  it("returns DEPRECATED_IMMUTABLE for a deprecated definition", () => {
    const rejection = checkPatchAllowed(
      { governance: "tenant", status: "deprecated", tenantId: TENANT },
      ["description"],
      TENANT,
    );
    expect(rejection?.code).toBe("DEPRECATED_IMMUTABLE");
    expect(rejection?.message).toContain("new version");
  });
});

// ─── versioning ──────────────────────────────────────────────────────────────

describe("nextVersionDraft", () => {
  const row: VersionableRow = {
    tenantId: TENANT,
    metricKey: "crm.retention_90d_rate",
    displayName: "Retention rate (90 day)",
    description: "desc",
    module: "crm",
    unit: "percent",
    aggregation: "ratio",
    numeratorSource: "crm.retained",
    denominatorSource: "crm.eligible",
    dimensions: ["region"],
    period: "rolling_90d",
    targetValue: "85.5",
    higherIsBetter: true,
    governance: "canonical",
    versionNumber: 3,
    status: "published",
  };

  it("copies the definition into a new draft at the next version number", () => {
    const draft = nextVersionDraft(row, TENANT);
    expect(draft.status).toBe("draft");
    expect(draft.versionNumber).toBe(4);
    expect(draft.metricKey).toBe(row.metricKey);
    expect(draft.targetValue).toBe("85.5");
    expect(draft.governance).toBe("canonical");
  });

  it("does not share the dimensions array with the source row", () => {
    const draft = nextVersionDraft(row, TENANT);
    draft.dimensions.push("channel");
    expect(row.dimensions).toEqual(["region"]);
  });

  it("downgrades governance to tenant when forking a platform-owned row", () => {
    const draft = nextVersionDraft({ ...row, tenantId: PLATFORM_TENANT_ID }, TENANT);
    expect(draft.governance).toBe("tenant");
    expect(draft.status).toBe("draft");
  });
});
