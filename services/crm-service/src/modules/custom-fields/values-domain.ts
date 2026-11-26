/**
 * Pure rules for custom-field VALUES and for the fail-closed PII definition guard
 * (GAP-CRM-CUSTOM-FIELDS-01, owner decision C10, 2026-11-26).
 *
 * Decision: values live in their own table (crm.custom_field_values), not a jsonb column on
 * contacts; and the API refuses to DEFINE a field whose name looks like a government / financial
 * identifier (Aadhaar, PAN, passport, ...) unless it is marked sensitive:true. "Fail closed":
 * an omitted or false flag on such a name is refused, never silently stored unprotected.
 *
 * No I/O here, so every rule is unit-testable without a database.
 */

/** Government / financial identifier words. Matched on whole words after camelCase / separator splitting. */
const SENSITIVE_NAME_RE =
  /\b(aadhaar|aadhar|adhar|uidai|pan|passport|ration|voter|epic|driving|licen[cs]e|dl|bank|ifsc|kyc|ssn|tin)\b|\baccount\s*(no|num|number)\b|\bcard\s*(no|num|number)\b/i;

/** Long, unambiguous identifier tokens: safe to match as substrings of the compacted name. */
const COMPACT_LONG_RE = /(aadhaar|aadhar|adhar|uidai|passport|voter|ifsc|drivinglicen[cs]e|bankaccount|accountnumber|cardnumber)/;
/** "pan" is too short to substring-match ("company"); only the explicit forms, anchored at the start. */
const COMPACT_PAN_RE = /^pan(card|no|num|number)?\d*$|^pan(card|no|num|number)/;

/** "aadhaarNumber" / "PAN_no" / "bank-account" -> lower words separated by single spaces. */
export function normaliseFieldName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-./]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** True when a custom-field NAME looks like it holds a government / financial identifier. */
export function isSensitiveFieldName(name: string): boolean {
  if (SENSITIVE_NAME_RE.test(normaliseFieldName(name))) return true;
  // Lowercase-concatenated names ("aadhaarnumber", "aadhaar1", "pancard") have no word boundary to
  // split on, so ALSO test the compacted name (lowercase, non-alphanumerics stripped).
  const compact = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return COMPACT_LONG_RE.test(compact) || COMPACT_PAN_RE.test(compact);
}

export const SENSITIVE_FIELD_REQUIRED = "SENSITIVE_FIELD_REQUIRED";

/**
 * Fail-closed definition guard. Returns an error message when `fieldName` looks sensitive and the
 * definition is not explicitly `sensitive: true`; null when the definition is acceptable.
 */
export function sensitiveDefinitionError(fieldName: string, validationSchema: unknown): string | null {
  if (!isSensitiveFieldName(fieldName)) return null;
  const sensitive = (validationSchema as { sensitive?: unknown } | null | undefined)?.sensitive;
  if (sensitive === true) return null;
  return `field name "${fieldName}" looks like a government or financial identifier (Aadhaar / PAN / passport / bank ...); it must be defined with sensitive:true`;
}

// ── Values ──────────────────────────────────────────────────────────────────

export interface FieldDef {
  id: string;
  fieldName: string;
  fieldType: string;
  validationSchema: unknown;
}

export interface FieldRules {
  required: boolean;
  sensitive: boolean;
  options: string[] | null;
  visibleToRoles: string[] | null;
}

export function rulesOf(def: FieldDef): FieldRules {
  const vs = (def.validationSchema ?? {}) as {
    required?: unknown; sensitive?: unknown; options?: unknown; visibleToRoles?: unknown;
  };
  return {
    required: vs.required === true,
    // Fail closed: a sensitive-looking NAME is protected even if a legacy definition lacks the flag.
    sensitive: vs.sensitive === true || isSensitiveFieldName(def.fieldName),
    options: Array.isArray(vs.options) ? vs.options.filter((o): o is string => typeof o === "string") : null,
    visibleToRoles: Array.isArray(vs.visibleToRoles)
      ? vs.visibleToRoles.filter((o): o is string => typeof o === "string")
      : null,
  };
}

const MAX_TEXT = 2000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Validate one value against its definition. Returns the normalised value, or an error string. */
export function validateValue(def: FieldDef, raw: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  const rules = rulesOf(def);
  const bad = (m: string) => ({ ok: false as const, error: `${def.fieldName}: ${m}` });
  switch (def.fieldType) {
    case "text": {
      if (typeof raw !== "string") return bad("must be text");
      const v = raw.trim();
      if (v.length === 0) return bad("must not be empty (send null to clear)");
      if (v.length > MAX_TEXT) return bad(`must be at most ${MAX_TEXT} characters`);
      return { ok: true, value: v };
    }
    case "number":
      return typeof raw === "number" && Number.isFinite(raw) ? { ok: true, value: raw } : bad("must be a finite number");
    case "boolean":
      return typeof raw === "boolean" ? { ok: true, value: raw } : bad("must be true or false");
    case "date": {
      if (typeof raw !== "string" || !ISO_DATE.test(raw)) return bad("must be a YYYY-MM-DD date");
      const d = new Date(`${raw}T00:00:00Z`);
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw) return bad("is not a real calendar date");
      return { ok: true, value: raw };
    }
    case "select": {
      if (typeof raw !== "string") return bad("must be one of the defined options");
      if (rules.options && !rules.options.includes(raw)) return bad(`must be one of: ${rules.options.join(", ")}`);
      return { ok: true, value: raw };
    }
    case "multi_select": {
      if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string")) return bad("must be a list of options");
      const list = [...new Set(raw as string[])];
      if (list.length === 0) return bad("must not be empty (send null to clear)");
      if (rules.options) {
        const unknown = list.filter((x) => !rules.options!.includes(x));
        if (unknown.length > 0) return bad(`unknown option(s): ${unknown.join(", ")}`);
      }
      return { ok: true, value: list };
    }
    default:
      return bad(`unsupported field type "${def.fieldType}"`);
  }
}

/** Roles that may read a sensitive value in the clear when the definition names none. */
export const DEFAULT_SENSITIVE_READ_ROLES = ["crm_admin", "super_admin"];

/** True when a caller with `roles` may see this field's value in the clear. */
export function canReadValue(rules: FieldRules, roles: readonly string[]): boolean {
  if (!rules.sensitive) return true;
  const allow = rules.visibleToRoles && rules.visibleToRoles.length > 0 ? rules.visibleToRoles : DEFAULT_SENSITIVE_READ_ROLES;
  return allow.some((r) => roles.includes(r));
}
