/**
 * segments/domain.ts — Criteria evaluation engine.
 * Builds SQL WHERE clauses from JSON filter definitions.
 *
 * Filter format:
 * {
 *   "conditions": [
 *     { "field": "attributes.city", "operator": "eq", "value": "Delhi" },
 *     { "field": "attributes.age", "operator": "gte", "value": 18 },
 *     { "field": "profileType", "operator": "eq", "value": "individual" }
 *   ],
 *   "logic": "and" | "or"
 * }
 */
import { sql, type SQL, and, or, eq } from "drizzle-orm";
import { profiles } from "../profiles/schema.js";

export type FilterOperator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "in";

export interface FilterCondition {
  field: string;
  operator: FilterOperator;
  value: unknown;
}

export interface SegmentCriteria {
  conditions: FilterCondition[];
  logic: "and" | "or";
}

/**
 * Validate segment criteria structure.
 * Returns null if valid, or an error message.
 */
export function validateCriteria(criteria: Record<string, unknown>): string | null {
  if (!criteria.conditions || !Array.isArray(criteria.conditions)) {
    return "criteria.conditions must be an array";
  }
  if (criteria.logic !== "and" && criteria.logic !== "or") {
    return "criteria.logic must be 'and' or 'or'";
  }
  for (const cond of criteria.conditions as unknown[]) {
    const c = cond as Record<string, unknown>;
    if (!c.field || typeof c.field !== "string") return "each condition must have a string 'field'";
    if (!c.operator || typeof c.operator !== "string") return "each condition must have a string 'operator'";
    const validOps: string[] = ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "in"];
    if (!validOps.includes(c.operator)) return `invalid operator: ${c.operator}`;
    if (c.value === undefined) return "each condition must have a 'value'";
  }
  return null;
}

/**
 * Build a SQL WHERE clause from segment criteria.
 * Supports both top-level profile fields and JSONB attribute fields.
 */
/**
 * Attribute bag normalised for SQL-side JSON access.
 *
 * The write path stores `attributes` double-encoded: the column ends up holding a jsonb
 * *string* whose content is the JSON document (`jsonb_typeof` = 'string'), because both
 * the ORM's jsonb mapper and the postgres driver serialise the value. Application reads
 * survive that because the two decodes cancel out, but `attributes->>'city'` evaluated
 * inside Postgres returns NULL — which silently made every attribute-based segment match
 * nothing. `#>> '{}'` extracts the inner text of a jsonb string, so it is re-parsed into
 * the object the predicate expects; correctly-encoded rows pass through untouched, so
 * this stays correct once the write path is fixed. See the report note on the encoding
 * root cause.
 */
const attributesJson = sql`CASE
  WHEN jsonb_typeof(${profiles.attributes}) = 'string'
    THEN (${profiles.attributes} #>> '{}')::jsonb
  ELSE ${profiles.attributes}
END`;

export function buildWhereClause(criteria: SegmentCriteria, tenantId: string): SQL {
  const tenantCondition = eq(profiles.tenantId, tenantId);

  if (criteria.conditions.length === 0) {
    return tenantCondition;
  }

  const sqlConditions: SQL[] = criteria.conditions.map((cond) => {
    const isJsonb = cond.field.startsWith("attributes.");
    const fieldPath = isJsonb ? cond.field.replace("attributes.", "") : cond.field;

    if (isJsonb) {
      return buildOperatorClause(sql`(${attributesJson})->>${fieldPath}`, cond.operator, cond.value);
    }

    // Top-level profile fields
    if (fieldPath === "profileType") {
      return buildOperatorClause(sql`${profiles.profileType}`, cond.operator, cond.value);
    }

    // Fallback: treat as JSONB attribute anyway
    return buildOperatorClause(sql`(${attributesJson})->>${fieldPath}`, cond.operator, cond.value);
  });

  const combined = criteria.logic === "and"
    ? and(...sqlConditions)!
    : or(...sqlConditions)!;

  return and(tenantCondition, combined)!;
}

function buildOperatorClause(field: SQL, operator: FilterOperator, value: unknown): SQL {
  const val = String(value);
  switch (operator) {
    case "eq":
      return sql`${field} = ${val}`;
    case "neq":
      return sql`${field} != ${val}`;
    case "gt":
      return sql`(${field})::numeric > ${Number(value)}`;
    case "gte":
      return sql`(${field})::numeric >= ${Number(value)}`;
    case "lt":
      return sql`(${field})::numeric < ${Number(value)}`;
    case "lte":
      return sql`(${field})::numeric <= ${Number(value)}`;
    case "contains":
      return sql`${field} ILIKE ${"%" + val + "%"}`;
    case "in": {
      if (Array.isArray(value)) {
        const values = value.map(String);
        return sql`${field} = ANY(${values})`;
      }
      return sql`${field} = ${val}`;
    }
    default:
      return sql`${field} = ${val}`;
  }
}
