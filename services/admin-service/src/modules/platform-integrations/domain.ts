/**
 * platform-integrations — pure domain logic (no I/O).
 *
 * Schema-driven validation of a tenant's integration form against the
 * catalogue's typed config schema, secret splitting, completeness per
 * environment, tenant availability and the production-switch guards.
 */
import { z } from "zod";
import type { IntegrationEnvironment, ProviderRow } from "./schema.js";

/** Error carrying an HTTP status + stable machine code for the route layer. */
export class IntegrationError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fieldErrors?: Array<{ field: string; message: string }>,
  ) {
    super(message);
    this.name = "IntegrationError";
  }
}

// ── config schema ────────────────────────────────────────────────────────────

export const FIELD_TYPES = ["text", "number", "url", "select", "boolean", "multiline", "keyRef"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

const fieldSchema = z.object({
  key: z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,63}$/),
  label: z.string(),
  labelHi: z.string().optional(),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().default(false),
  secret: z.boolean().default(false),
  /** Changing it on a live production record needs re-approval (endpoint/account/credential-bearing fields). */
  sensitive: z.boolean().default(false),
  environments: z.array(z.enum(["sandbox", "production"])).default(["sandbox", "production"]),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  showWhen: z.object({ field: z.string(), equals: z.string() }).optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  pattern: z.string().optional(),
  minLength: z.number().int().optional(),
  maxLength: z.number().int().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  help: z.string().optional(),
  helpHi: z.string().optional(),
});
export type ConfigField = z.infer<typeof fieldSchema>;

/** Narrow the jsonb config_schema to typed fields; malformed entries are dropped, never trusted. */
export function parseFields(raw: unknown): ConfigField[] {
  const list = (raw as { fields?: unknown } | null | undefined)?.fields;
  if (!Array.isArray(list)) return [];
  const out: ConfigField[] = [];
  for (const f of list) {
    const p = fieldSchema.safeParse(f);
    if (p.success) out.push(p.data);
  }
  return out;
}

/** A field is active when it has no showWhen, or its controlling field currently equals the value. */
export function fieldActive(field: ConfigField, config: Record<string, unknown>): boolean {
  if (!field.showWhen) return true;
  const current = config[field.showWhen.field];
  return String(current ?? "") === field.showWhen.equals;
}

// ── input validation ─────────────────────────────────────────────────────────

export type RecordInput = {
  config: Record<string, unknown>;
  /** secret field -> plaintext. Empty/absent = keep the stored value (write-only semantics). */
  secrets: Record<string, string>;
};

export type ValidatedInput = {
  config: Record<string, unknown>;
  secrets: Record<string, string>;
};

function checkValue(field: ConfigField, value: unknown): { ok: true; value: string | number | boolean } | { ok: false; message: string } {
  switch (field.type) {
    case "boolean":
      return typeof value === "boolean" ? { ok: true, value } : { ok: false, message: "must be true or false" };
    case "number": {
      const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
      if (typeof n !== "number" || !Number.isFinite(n)) return { ok: false, message: "must be a number" };
      if (field.min !== undefined && n < field.min) return { ok: false, message: `must be at least ${field.min}` };
      if (field.max !== undefined && n > field.max) return { ok: false, message: `must be at most ${field.max}` };
      return { ok: true, value: n };
    }
    case "select": {
      if (typeof value !== "string") return { ok: false, message: "must be one of the listed options" };
      return (field.options ?? []).some((o) => o.value === value)
        ? { ok: true, value }
        : { ok: false, message: "must be one of the listed options" };
    }
    default: {
      if (typeof value !== "string") return { ok: false, message: "must be text" };
      const v = value.trim();
      const max = field.maxLength ?? (field.type === "multiline" ? 8192 : 512);
      if (v.length > max) return { ok: false, message: `must be at most ${max} characters` };
      if (field.minLength !== undefined && v.length < field.minLength) return { ok: false, message: `must be at least ${field.minLength} characters` };
      if (field.type === "url") {
        try {
          const u = new URL(v);
          if (u.protocol !== "https:") return { ok: false, message: "must be an https URL" };
        } catch {
          return { ok: false, message: "must be a valid URL" };
        }
      }
      if (field.pattern && !new RegExp(field.pattern).test(v)) return { ok: false, message: "has an invalid format" };
      return { ok: true, value: v };
    }
  }
}

/**
 * Validate a tenant's form submission against the provider's field schema.
 * Unknown fields, secrets sent as plain config, and plain fields sent as
 * secrets are all rejected. Values of fields hidden by `showWhen` are dropped.
 */
export function validateRecordInput(fields: ConfigField[], input: RecordInput): ValidatedInput {
  const errors: Array<{ field: string; message: string }> = [];
  const byKey = new Map(fields.map((f) => [f.key, f]));

  const rawConfig: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input.config)) {
    const f = byKey.get(k);
    if (!f) { errors.push({ field: k, message: "is not a field of this provider" }); continue; }
    if (f.secret) { errors.push({ field: k, message: "is a secret; send it in `secrets`" }); continue; }
    if (v === "" || v === null || v === undefined) continue; // blank = unset
    const r = checkValue(f, v);
    if (!r.ok) { errors.push({ field: k, message: r.message }); continue; }
    rawConfig[k] = r.value;
  }

  const secrets: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.secrets)) {
    const f = byKey.get(k);
    if (!f) { errors.push({ field: k, message: "is not a field of this provider" }); continue; }
    if (!f.secret) { errors.push({ field: k, message: "is not a secret field" }); continue; }
    if (v === "") continue; // write-only: blank keeps the stored value
    const r = checkValue({ ...f, type: f.type === "multiline" ? "multiline" : "text" }, v);
    if (!r.ok) { errors.push({ field: k, message: r.message }); continue; }
    secrets[k] = String(r.value);
  }

  if (errors.length > 0) {
    throw new IntegrationError(400, "VALIDATION_FAILED", "invalid integration configuration", errors);
  }

  // Drop config values of fields hidden by their controlling field.
  const config: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.secret) continue;
    const v = rawConfig[f.key];
    if (v !== undefined && fieldActive(f, rawConfig)) config[f.key] = v;
  }
  return { config, secrets };
}

/** Secret field keys that became inactive (hidden) under the new config; their stored value is cleared. */
export function inactiveSecretKeys(fields: ConfigField[], config: Record<string, unknown>, storedKeys: string[]): string[] {
  const inactive = new Set(fields.filter((f) => f.secret && !fieldActive(f, config)).map((f) => f.key));
  return storedKeys.filter((k) => inactive.has(k));
}

/**
 * Required fields still missing for `env`. Secrets count as present when a
 * sealed value is stored (or being written in the same save).
 */
export function missingRequired(
  fields: ConfigField[],
  env: IntegrationEnvironment,
  config: Record<string, unknown>,
  secretKeysPresent: Iterable<string>,
): string[] {
  const have = new Set(secretKeysPresent);
  const missing: string[] = [];
  for (const f of fields) {
    if (!f.required || !f.environments.includes(env) || !fieldActive(f, config)) continue;
    const present = f.secret ? have.has(f.key) : config[f.key] !== undefined && config[f.key] !== "";
    if (!present) missing.push(f.key);
  }
  return missing;
}

// ── sensitive fields ─────────────────────────────────────────────────────────

/**
 * Keys whose change on a production record forces re-approval. Secrets are
 * always sensitive. When a schema marks no field `sensitive`, EVERY field is
 * treated as sensitive (fail closed).
 */
export function sensitiveKeys(fields: ConfigField[]): Set<string> {
  const marked = fields.filter((f) => f.sensitive || f.secret);
  const anyMarked = fields.some((f) => f.sensitive);
  return new Set((anyMarked ? marked : fields).map((f) => f.key));
}

/** Does this save change anything sensitive? Any secret write/clear, or a changed sensitive config value. */
export function touchesSensitive(
  fields: ConfigField[],
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  secretKeysWritten: readonly string[],
  secretKeysCleared: readonly string[],
): boolean {
  if (secretKeysWritten.length > 0 || secretKeysCleared.length > 0) return true;
  const sens = sensitiveKeys(fields);
  for (const f of fields) {
    if (f.secret || !sens.has(f.key)) continue;
    if (JSON.stringify(before[f.key] ?? null) !== JSON.stringify(after[f.key] ?? null)) return true;
  }
  return false;
}

// ── availability / eligibility ───────────────────────────────────────────────

export function isAvailableToTenant(
  p: Pick<ProviderRow, "status" | "availabilityMode" | "allowedTenantIds" | "allowedEditions">,
  tenantId: string,
  edition: string | null,
): boolean {
  if (p.status === "disabled") return false;
  if (p.availabilityMode === "all") return true;
  if (p.allowedTenantIds.includes(tenantId)) return true;
  return edition !== null && p.allowedEditions.includes(edition);
}

/** Beta providers are sandbox-only; a disabled provider cannot be used at all. */
export function assertProductionEligible(status: string): void {
  if (status === "disabled") {
    throw new IntegrationError(409, "PROVIDER_DISABLED", "this provider has been disabled by the platform");
  }
  if (status === "beta") {
    throw new IntegrationError(409, "PROVIDER_BETA_SANDBOX_ONLY", "beta providers can only run in the sandbox environment");
  }
}

/** Maker-checker: the person who raised the production switch can never decide it. */
export function assertDeciderDistinct(requesterId: string, deciderId: string): void {
  if (requesterId === deciderId) {
    throw new IntegrationError(409, "MAKER_CHECKER_VIOLATION", "the production switch must be approved by someone other than the requester");
  }
}

export function assertVersion(expected: number, actual: number): void {
  if (expected !== actual) {
    throw new IntegrationError(409, "VERSION_CONFLICT", `stale version: expected ${expected} but current is ${actual}; re-read and retry`);
  }
}

// ── masking ──────────────────────────────────────────────────────────────────

export const SECRET_MASK = "••••••••";

/** Per-secret-field status for display. The sealed value itself is NEVER included. */
export function maskedSecrets(fields: ConfigField[], sealed: Record<string, string>): Array<{ key: string; label: string; set: boolean; masked: string | null }> {
  return fields.filter((f) => f.secret).map((f) => {
    const set = typeof sealed[f.key] === "string" && sealed[f.key] !== "";
    return { key: f.key, label: f.label, set, masked: set ? SECRET_MASK : null };
  });
}
