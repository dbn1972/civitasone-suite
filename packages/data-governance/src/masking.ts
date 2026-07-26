/**
 * CAP-085 — field-level masking / redaction policy engine.
 *
 * A MaskingPolicy declares, per field, a masking strategy and the roles allowed
 * to see the raw value. `applyMasking` returns a shallow copy of a record with
 * every field the caller's roles are NOT permitted to see replaced by its
 * masked form. Pure and deterministic.
 */
import { createHash } from "node:crypto";

export type MaskStrategy = "redact" | "partial4" | "email" | "hash" | "none";

/** A custom masking formatter — services plug their own exact output format. */
export type MaskFn = (value: unknown) => unknown;

export interface FieldRule {
  /** A built-in strategy name, or a custom formatter function. */
  strategy: MaskStrategy | MaskFn;
  /** Roles that may see the unmasked value. Empty ⇒ nobody (always masked). */
  allowRoles?: string[];
}

export type MaskingPolicy = Record<string, FieldRule>;

export function maskValue(value: unknown, strategy: MaskStrategy): unknown {
  if (value === null || value === undefined) return value;
  const s = String(value);
  switch (strategy) {
    case "none": return value;
    case "redact": return "*".repeat(Math.min(s.length, 8)) || "****";
    case "partial4": return s.length <= 4 ? "****" : "*".repeat(s.length - 4) + s.slice(-4);
    case "email": {
      const at = s.indexOf("@");
      if (at <= 0) return "****";
      const name = s.slice(0, at);
      const domain = s.slice(at);
      const head = name[0] ?? "";
      return `${head}${"*".repeat(Math.max(name.length - 1, 1))}${domain}`;
    }
    case "hash": return "sha256:" + createHash("sha256").update(s).digest("hex").slice(0, 16);
    default: return "****";
  }
}

/** True when at least one of the caller's roles is allowed to see the field raw. */
export function roleAllowed(rule: FieldRule, roles: string[]): boolean {
  const allow = rule.allowRoles ?? [];
  return allow.length > 0 && roles.some((r) => allow.includes(r));
}

/** Return a masked copy of `record` per `policy` for a caller with `roles`. */
export function applyMasking<T extends Record<string, unknown>>(record: T, policy: MaskingPolicy, roles: string[]): T {
  const out: Record<string, unknown> = { ...record };
  for (const [field, rule] of Object.entries(policy)) {
    if (!(field in out)) continue;
    if (rule.strategy === "none") continue;
    if (roleAllowed(rule, roles)) continue;
    out[field] = typeof rule.strategy === "function"
      ? rule.strategy(out[field])
      : maskValue(out[field], rule.strategy);
  }
  return out as T;
}

/** Mask every element of a collection. */
export function applyMaskingList<T extends Record<string, unknown>>(records: T[], policy: MaskingPolicy, roles: string[]): T[] {
  return records.map((r) => applyMasking(r, policy, roles));
}
