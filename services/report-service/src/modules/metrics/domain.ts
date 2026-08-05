/**
 * metrics/domain.ts — pure governance logic for the metric definition catalogue.
 *
 * No I/O, no Drizzle, no Fastify: every rule here is unit-testable without a
 * database. Routes and the consumer both call into these functions so the
 * governance rules cannot drift between the read and write paths.
 *
 * SECURITY: `numeratorSource` / `denominatorSource` are opaque logical identifiers
 * validated against SOURCE_KEY_PATTERN. They are NEVER interpolated into SQL —
 * this module stores and serves definitions, it does not execute them.
 */

export const AGGREGATIONS = [
  "sum",
  "avg",
  "min",
  "max",
  "count",
  "count_distinct",
  "ratio",
  "percent",
] as const;
export type MetricAggregation = (typeof AGGREGATIONS)[number];

export const PERIODS = [
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
  "rolling_30d",
  "rolling_90d",
] as const;
export type MetricPeriod = (typeof PERIODS)[number];

export const STATUSES = ["draft", "published", "deprecated"] as const;
export type MetricStatus = (typeof STATUSES)[number];

export const GOVERNANCES = ["canonical", "tenant"] as const;
export type MetricGovernance = (typeof GOVERNANCES)[number];

/** Aggregations that are a quotient and therefore need a denominator source. */
export const RATIO_AGGREGATIONS: readonly MetricAggregation[] = ["ratio", "percent"];

/**
 * Allowlist for logical source identifiers. Deliberately narrow: lowercase
 * letters, digits, underscore and dot only, 3–200 chars, must start with a letter.
 * Anything that could carry SQL syntax (quotes, parens, whitespace, semicolons,
 * comment markers) is rejected outright.
 */
export const SOURCE_KEY_PATTERN = /^[a-z][a-z0-9_.]{2,199}$/;

/** Same shape as a source key but capped at the metric_key column width (96). */
export const METRIC_KEY_PATTERN = /^[a-z][a-z0-9_.]{2,95}$/;

/** Dimension name allowlist — identifier-ish, no separators. */
export const DIMENSION_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

export const MAX_DIMENSIONS = 12;
export const MAX_DIMENSION_LENGTH = 64;

/**
 * Owner of platform-standard (`canonical`) definitions seeded by migration 0018.
 * Same nil-uuid convention notification-service uses for its system templates.
 * Every tenant can READ these rows (RLS policy carve-out) but none can write them.
 */
export const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";

/** Fields a tenant may override on a published definition. */
export const TENANT_OVERRIDABLE_FIELDS = ["description", "targetValue", "dimensions"] as const;

/** Fields frozen on a published `canonical` definition. */
export const CANONICAL_IMMUTABLE_FIELDS = ["metricKey", "unit", "aggregation", "period"] as const;

export interface FieldError {
  field: string;
  message: string;
}

/** Shape validated by {@link validateMetricDefinition}. */
export interface MetricDefinitionInput {
  metricKey: string;
  aggregation: string;
  numeratorSource: string;
  denominatorSource?: string | null;
  dimensions?: readonly unknown[];
  period: string;
  governance?: string;
}

export function isValidSourceKey(value: unknown): boolean {
  return typeof value === "string" && SOURCE_KEY_PATTERN.test(value);
}

export function isValidMetricKey(value: unknown): boolean {
  return typeof value === "string" && METRIC_KEY_PATTERN.test(value);
}

export function isAggregation(value: unknown): value is MetricAggregation {
  return typeof value === "string" && (AGGREGATIONS as readonly string[]).includes(value);
}

export function isPeriod(value: unknown): value is MetricPeriod {
  return typeof value === "string" && (PERIODS as readonly string[]).includes(value);
}

export function isStatus(value: unknown): value is MetricStatus {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

export function isGovernance(value: unknown): value is MetricGovernance {
  return typeof value === "string" && (GOVERNANCES as readonly string[]).includes(value);
}

/** True when the aggregation is a quotient and a denominator source is mandatory. */
export function requiresDenominator(aggregation: string): boolean {
  return (RATIO_AGGREGATIONS as readonly string[]).includes(aggregation);
}

/**
 * ratio/percent MUST carry a denominator source; every other aggregation MUST NOT.
 * Mirrored by the `chk_metric_definitions_denominator` table CHECK constraint.
 */
export function validateDenominatorRule(input: {
  aggregation: string;
  denominatorSource?: string | null;
}): FieldError | null {
  const has = typeof input.denominatorSource === "string" && input.denominatorSource.length > 0;
  if (requiresDenominator(input.aggregation) && !has) {
    return {
      field: "denominatorSource",
      message: `denominatorSource is required when aggregation is '${input.aggregation}'`,
    };
  }
  if (!requiresDenominator(input.aggregation) && has) {
    return {
      field: "denominatorSource",
      message: `denominatorSource must be null when aggregation is '${input.aggregation}'`,
    };
  }
  return null;
}

/**
 * Slice dimensions: at most {@link MAX_DIMENSIONS} entries, each 1–64 chars,
 * no duplicates. An empty list is valid (the metric is not sliceable).
 */
export function validateDimensions(dimensions: readonly unknown[] | undefined): FieldError | null {
  if (dimensions === undefined) return null;
  if (dimensions.length > MAX_DIMENSIONS) {
    return { field: "dimensions", message: `at most ${MAX_DIMENSIONS} dimensions allowed` };
  }
  const seen = new Set<string>();
  for (const raw of dimensions) {
    if (typeof raw !== "string") {
      return { field: "dimensions", message: "each dimension must be a string" };
    }
    if (raw.length === 0) {
      return { field: "dimensions", message: "dimension name must not be empty" };
    }
    if (raw.length > MAX_DIMENSION_LENGTH) {
      return {
        field: "dimensions",
        message: `dimension name must be at most ${MAX_DIMENSION_LENGTH} characters`,
      };
    }
    if (!DIMENSION_PATTERN.test(raw)) {
      return { field: "dimensions", message: `dimension '${raw}' is not a valid identifier` };
    }
    if (seen.has(raw)) {
      return { field: "dimensions", message: `duplicate dimension '${raw}'` };
    }
    seen.add(raw);
  }
  return null;
}

/** Full definition validation. Returns every violation so callers can report all at once. */
export function validateMetricDefinition(input: MetricDefinitionInput): FieldError[] {
  const errors: FieldError[] = [];

  if (!isValidMetricKey(input.metricKey)) {
    errors.push({ field: "metricKey", message: "metricKey must match ^[a-z][a-z0-9_.]{2,95}$" });
  }
  if (!isAggregation(input.aggregation)) {
    errors.push({
      field: "aggregation",
      message: `aggregation must be one of: ${AGGREGATIONS.join("|")}`,
    });
  }
  if (!isPeriod(input.period)) {
    errors.push({ field: "period", message: `period must be one of: ${PERIODS.join("|")}` });
  }
  if (input.governance !== undefined && !isGovernance(input.governance)) {
    errors.push({ field: "governance", message: `governance must be one of: ${GOVERNANCES.join("|")}` });
  }
  if (!isValidSourceKey(input.numeratorSource)) {
    errors.push({
      field: "numeratorSource",
      message: "numeratorSource must be a logical source identifier matching ^[a-z][a-z0-9_.]{2,199}$",
    });
  }
  if (
    input.denominatorSource !== undefined &&
    input.denominatorSource !== null &&
    !isValidSourceKey(input.denominatorSource)
  ) {
    errors.push({
      field: "denominatorSource",
      message: "denominatorSource must be a logical source identifier matching ^[a-z][a-z0-9_.]{2,199}$",
    });
  }

  const denomError = validateDenominatorRule({
    aggregation: input.aggregation,
    denominatorSource: input.denominatorSource ?? null,
  });
  if (denomError) errors.push(denomError);

  const dimError = validateDimensions(input.dimensions);
  if (dimError) errors.push(dimError);

  return errors;
}

/**
 * Publishing is one-way: draft → published → deprecated. There is no path back;
 * a superseding definition is created as a new versionNumber, not by reopening
 * an old row.
 */
export const ALLOWED_TRANSITIONS: Record<MetricStatus, readonly MetricStatus[]> = {
  draft: ["published"],
  published: ["deprecated"],
  deprecated: [],
};

export function canTransition(from: string, to: string): boolean {
  if (!isStatus(from) || !isStatus(to)) return false;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Returns null when the transition is legal, otherwise a human-readable reason. */
export function validateStatusTransition(from: string, to: string): string | null {
  if (canTransition(from, to)) return null;
  return `cannot transition metric definition from '${from}' to '${to}'`;
}

/** The column patch that a legal transition implies. Pure — the caller supplies `at`. */
export function statusTransitionPatch(
  to: MetricStatus,
  at: Date,
): { status: MetricStatus; publishedAt?: Date; deprecatedAt?: Date } {
  if (to === "published") return { status: to, publishedAt: at };
  if (to === "deprecated") return { status: to, deprecatedAt: at };
  return { status: to };
}

export type PatchRejectionCode =
  | "CANONICAL_IMMUTABLE"
  | "PUBLISHED_IMMUTABLE"
  | "DEPRECATED_IMMUTABLE";

export interface PatchRejection {
  code: PatchRejectionCode;
  fields: string[];
  message: string;
}

function isOverridable(field: string): boolean {
  return (TENANT_OVERRIDABLE_FIELDS as readonly string[]).includes(field);
}

/**
 * Governance gate for PATCH.
 *
 * - `draft`      → anything may change.
 * - `published`  → only {@link TENANT_OVERRIDABLE_FIELDS}. On a `canonical` row the
 *                  rejection is `CANONICAL_IMMUTABLE` (409); on a tenant row it is
 *                  `PUBLISHED_IMMUTABLE` (409). Either way the shape of the metric
 *                  (metricKey/unit/aggregation/period) is frozen once published so
 *                  two circles' numbers stay comparable.
 * - `deprecated` → frozen entirely.
 *
 * A platform-owned canonical row (tenantId === {@link PLATFORM_TENANT_ID}) is
 * read-only for every tenant: the override path is POST /versions, which copies
 * the row into the caller's tenant as a fresh draft.
 *
 * `fields` is the set of column names the caller intends to change (already
 * narrowed to fields whose value actually differs, where the caller can tell).
 */
export function checkPatchAllowed(
  existing: { governance: string; status: string; tenantId: string },
  fields: readonly string[],
  callerTenantId: string,
): PatchRejection | null {
  if (fields.length === 0) return null;

  if (existing.tenantId !== callerTenantId) {
    return {
      code: "CANONICAL_IMMUTABLE",
      fields: [...fields],
      message:
        "platform canonical definitions are read-only; POST /versions to create a tenant-owned override",
    };
  }

  if (existing.status === "deprecated") {
    return {
      code: "DEPRECATED_IMMUTABLE",
      fields: [...fields],
      message: "a deprecated metric definition cannot be modified; create a new version instead",
    };
  }

  if (existing.status === "published") {
    const offending = fields.filter((f) => !isOverridable(f));
    if (offending.length === 0) return null;
    if (existing.governance === "canonical") {
      return {
        code: "CANONICAL_IMMUTABLE",
        fields: offending,
        message:
          `published canonical definitions freeze ${CANONICAL_IMMUTABLE_FIELDS.join(", ")}; ` +
          `only ${TENANT_OVERRIDABLE_FIELDS.join(", ")} may be overridden (offending: ${offending.join(", ")})`,
      };
    }
    return {
      code: "PUBLISHED_IMMUTABLE",
      fields: offending,
      message:
        `a published definition only accepts ${TENANT_OVERRIDABLE_FIELDS.join(", ")}; ` +
        `create a new version to change ${offending.join(", ")}`,
    };
  }

  return null;
}

/** Row fields the version-copy reads from. */
export interface VersionableRow {
  tenantId: string;
  metricKey: string;
  displayName: string;
  description: string | null;
  module: string;
  unit: string;
  aggregation: string;
  numeratorSource: string;
  denominatorSource: string | null;
  dimensions: string[];
  period: string;
  targetValue: string | null;
  higherIsBetter: boolean;
  governance: string;
  versionNumber: number;
  status: string;
}

export interface NextVersionDraft extends Omit<VersionableRow, "status" | "tenantId"> {
  status: "draft";
  versionNumber: number;
}

/**
 * Build the next `versionNumber` of a definition as a fresh draft. The source row
 * is left untouched — it keeps serving traffic until it is explicitly deprecated.
 *
 * When the source row is platform-owned the copy is downgraded to
 * `governance: "tenant"`: a tenant may fork a canonical definition but may not
 * mint new canonical ones (those arrive only through a platform data migration).
 */
export function nextVersionDraft(row: VersionableRow, callerTenantId: string): NextVersionDraft {
  const ownedByCaller = row.tenantId === callerTenantId;
  return {
    metricKey: row.metricKey,
    displayName: row.displayName,
    description: row.description,
    module: row.module,
    unit: row.unit,
    aggregation: row.aggregation,
    numeratorSource: row.numeratorSource,
    denominatorSource: row.denominatorSource,
    dimensions: [...row.dimensions],
    period: row.period,
    targetValue: row.targetValue,
    higherIsBetter: row.higherIsBetter,
    governance: ownedByCaller ? row.governance : "tenant",
    versionNumber: row.versionNumber + 1,
    status: "draft",
  };
}
