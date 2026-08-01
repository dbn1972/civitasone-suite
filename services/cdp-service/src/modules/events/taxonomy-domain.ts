/**
 * events/taxonomy-domain.ts — CDP-004 event taxonomy governance (PURE).
 *
 * A CDP without a governed taxonomy accumulates `order_placed`, `orderPlaced` and
 * `Order Placed` as three unrelated behaviours, and every segment built on them is
 * quietly wrong. The registry makes an event name a reviewed contract: draft → approved
 * → deprecated, and only an approved definition may be ingested against.
 */

export const TAXONOMY_STATUSES = ["draft", "approved", "deprecated"] as const;
export type TaxonomyStatus = (typeof TAXONOMY_STATUSES)[number];

/** Supported field types in a taxonomy schema definition. */
export const FIELD_TYPES = ["string", "number", "boolean", "object", "array"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export interface FieldSpec {
  type: FieldType;
  required?: boolean;
}

/**
 * A taxonomy schema is a flat map of field name → spec. Deliberately not full JSON
 * Schema: the governance value is in agreeing what fields an event carries, and a
 * restricted grammar is one a non-engineer reviewer can actually read and approve.
 */
export type TaxonomySchema = Record<string, FieldSpec>;

/** Legal status transitions. Approval is one-way; a deprecated event is never revived. */
const TRANSITIONS: Record<TaxonomyStatus, readonly TaxonomyStatus[]> = {
  draft: ["draft", "approved", "deprecated"],
  approved: ["approved", "deprecated"],
  deprecated: ["deprecated"],
};

export function canTransition(from: string, to: TaxonomyStatus): boolean {
  const allowed = TRANSITIONS[from as TaxonomyStatus];
  return allowed !== undefined && allowed.includes(to);
}

/** Validate the shape of a schema definition. Returns null when valid. */
export function validateSchemaDefinition(schemaJson: Record<string, unknown>): string | null {
  for (const [field, rawSpec] of Object.entries(schemaJson)) {
    if (typeof rawSpec !== "object" || rawSpec === null || Array.isArray(rawSpec)) {
      return `field "${field}" must map to an object with a "type"`;
    }
    const spec = rawSpec as Record<string, unknown>;
    if (typeof spec.type !== "string" || !(FIELD_TYPES as readonly string[]).includes(spec.type)) {
      return `field "${field}" has an unsupported type; expected one of ${FIELD_TYPES.join(", ")}`;
    }
    if (spec.required !== undefined && typeof spec.required !== "boolean") {
      return `field "${field}" has a non-boolean "required"`;
    }
  }
  return null;
}

function actualType(value: unknown): FieldType | "null" {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean" || t === "object") return t;
  return "null";
}

export interface PayloadViolation {
  field: string;
  reason: string;
}

/**
 * Check an event payload against a taxonomy schema.
 *
 * Unknown fields are reported but do not fail validation: producers legitimately run
 * ahead of a schema review, and rejecting the whole event would lose data that is
 * otherwise valid. Missing required fields and wrong types DO fail — those break every
 * consumer downstream.
 */
export function validatePayload(
  payload: Record<string, unknown>,
  schemaJson: Record<string, unknown>,
): { valid: boolean; violations: PayloadViolation[]; unknownFields: string[] } {
  const violations: PayloadViolation[] = [];

  for (const [field, rawSpec] of Object.entries(schemaJson)) {
    if (typeof rawSpec !== "object" || rawSpec === null || Array.isArray(rawSpec)) continue;
    const spec = rawSpec as { type?: unknown; required?: unknown };
    const present = Object.prototype.hasOwnProperty.call(payload, field) && payload[field] !== null
      && payload[field] !== undefined;

    if (!present) {
      if (spec.required === true) {
        violations.push({ field, reason: "required field is missing" });
      }
      continue;
    }

    const expected = spec.type;
    const found = actualType(payload[field]);
    if (typeof expected === "string" && found !== expected) {
      violations.push({ field, reason: `expected ${expected}, received ${found}` });
    }
  }

  const declared = new Set(Object.keys(schemaJson));
  const unknownFields = Object.keys(payload).filter((k) => !declared.has(k));

  return { valid: violations.length === 0, violations, unknownFields };
}
