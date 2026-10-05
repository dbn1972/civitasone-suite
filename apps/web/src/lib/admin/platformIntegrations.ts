/**
 * Pure helpers + wire types for the platform-integration screens (eSign, DSC,
 * bank API, PFMS, OCR): the super-admin catalogue at /admin/platform/integrations and
 * the tenant configuration at /admin/integrations/platform.
 *
 * Mirrors admin-service modules/platform-integrations. Everything here is pure
 * (no fetch, no React) so it is unit-testable and keeps `.length === 0`-style
 * emptiness checks out of page files.
 */

export const CATEGORIES = ["esign", "dsc", "bank_api", "pfms", "ocr"] as const;
export type IntegrationCategory = (typeof CATEGORIES)[number];
export type IntegrationEnv = "sandbox" | "production";
export type ProviderStatus = "available" | "beta" | "disabled";
export const EDITIONS = ["govt_dept", "psu", "small_office"] as const;
export type Edition = (typeof EDITIONS)[number];

export const PLATFORM_API = "/api/proxy/v1/admin/platform-integrations";
export const TENANT_API = `${PLATFORM_API}/tenant`;

export type FieldType = "text" | "number" | "url" | "select" | "boolean" | "multiline" | "keyRef";

export type FieldDef = {
  key: string;
  label: string;
  labelHi?: string;
  type: FieldType;
  required: boolean;
  secret: boolean;
  /** Changing it on a live production record sends the integration back to sandbox. */
  sensitive?: boolean;
  environments: IntegrationEnv[];
  options?: Array<{ value: string; label: string }>;
  showWhen?: { field: string; equals: string };
  default?: string | number | boolean;
  maxLength?: number;
  min?: number;
  max?: number;
  help?: string;
  helpHi?: string;
};

export type EndpointMap = { sandbox: string | null; production: string | null };

export type PlatformProvider = {
  key: string;
  category: IntegrationCategory;
  name: string;
  vendor: string;
  description: string;
  capabilities: string[];
  fields: FieldDef[];
  endpoints: EndpointMap;
  status: ProviderStatus;
  availability: { mode: "all" | "restricted"; tenantIds: string[]; editions: string[] };
  usage: { sandbox: number; production: number };
  version: number;
};

export type TenantCatalogueProvider = Omit<PlatformProvider, "availability" | "usage" | "version"> & { configured: boolean };

export type SecretStatus = { key: string; label: string; set: boolean; masked: string | null };

export type Health = {
  status: "untested" | "success" | "failure";
  code: string | null;
  message: string | null;
  testedAt: string | null;
  environment: IntegrationEnv | null;
};

export type SwitchRequest = {
  id: string;
  providerKey: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  reason: string;
  requestedBy: string;
  requestedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  direct: boolean;
};

export type TenantRecord = {
  id: string;
  providerKey: string;
  category: IntegrationCategory;
  providerName: string;
  providerStatus: ProviderStatus;
  environment: IntegrationEnv;
  enabled: boolean;
  config: Record<string, unknown>;
  secrets: SecretStatus[];
  missingRequired: { sandbox: string[]; production: string[] };
  health: Health;
  version: number;
  updatedAt: string | null;
  pendingSwitch?: SwitchRequest | null;
};

// ── emptiness / grouping ─────────────────────────────────────────────────────

export function isEmptyList(list: readonly unknown[]): boolean {
  return list.length === 0;
}

export function byCategory<T extends { category: IntegrationCategory }>(rows: readonly T[], category: IntegrationCategory): T[] {
  return rows.filter((r) => r.category === category);
}

/** A record is "in use" once it has been saved at all. */
export function recordFor(records: readonly TenantRecord[], providerKey: string): TenantRecord | undefined {
  return records.find((r) => r.providerKey === providerKey);
}

// ── schema-driven form ───────────────────────────────────────────────────────

export function fieldLabel(f: FieldDef, locale: string): string {
  return locale === "hi" && f.labelHi ? f.labelHi : f.label;
}

export function fieldHelp(f: FieldDef, locale: string): string | undefined {
  return locale === "hi" && f.helpHi ? f.helpHi : f.help;
}

export type FormValues = Record<string, string | boolean>;

/** A field is shown when it has no showWhen, or its controlling field currently equals the value. */
export function fieldVisible(f: FieldDef, values: FormValues): boolean {
  if (!f.showWhen) return true;
  return String(values[f.showWhen.field] ?? "") === f.showWhen.equals;
}

/** Seed form values from a stored record, falling back to the field default. Secrets are never seeded. */
export function initialValues(fields: readonly FieldDef[], config: Record<string, unknown> | undefined): FormValues {
  const out: FormValues = {};
  for (const f of fields) {
    if (f.secret) continue;
    const stored = config?.[f.key];
    if (f.type === "boolean") {
      out[f.key] = typeof stored === "boolean" ? stored : f.default === true;
    } else if (stored !== undefined && stored !== null) {
      out[f.key] = String(stored);
    } else if (config === undefined && f.default !== undefined) {
      out[f.key] = String(f.default);
    } else {
      out[f.key] = "";
    }
  }
  return out;
}

export type SaveInput = {
  fields: readonly FieldDef[];
  values: FormValues;
  /** Secret inputs the user typed. Blank = keep what is stored. */
  secretInputs: Record<string, string>;
  /** Secret fields the user explicitly asked to clear. */
  clearSecrets: readonly string[];
  enabled: boolean;
  /** Present when updating an existing record. */
  expectedVersion?: number | undefined;
};

/** Build the PUT body. Hidden fields are omitted; numbers are sent as numbers; blank secrets are not sent. */
export function buildSaveBody(input: SaveInput): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const f of input.fields) {
    if (f.secret || !fieldVisible(f, input.values)) continue;
    const v = input.values[f.key];
    if (f.type === "boolean") {
      config[f.key] = v === true;
    } else if (typeof v === "string" && v.trim() !== "") {
      config[f.key] = f.type === "number" ? Number(v) : v.trim();
    }
  }
  const secrets: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.secretInputs)) {
    if (v !== "") secrets[k] = v;
  }
  const clearSecrets = input.clearSecrets.filter((k) => !(k in secrets));
  return {
    config,
    secrets,
    clearSecrets,
    enabled: input.enabled,
    ...(input.expectedVersion !== undefined ? { expectedVersion: input.expectedVersion } : {}),
  };
}

/**
 * Required fields still missing for `env` given the current form (a UI hint that
 * mirrors the server's completeness check; the server remains the authority).
 */
export function missingForEnv(
  fields: readonly FieldDef[],
  env: IntegrationEnv,
  values: FormValues,
  secretKeysSet: readonly string[],
  pendingSecrets: Record<string, string> = {},
  clearing: readonly string[] = [],
): string[] {
  const have = new Set([...secretKeysSet.filter((k) => !clearing.includes(k)), ...Object.keys(pendingSecrets).filter((k) => pendingSecrets[k] !== "")]);
  const missing: string[] = [];
  for (const f of fields) {
    if (!f.required || !f.environments.includes(env) || !fieldVisible(f, values)) continue;
    if (f.secret) {
      if (!have.has(f.key)) missing.push(f.key);
    } else {
      const v = values[f.key];
      if (f.type === "boolean" ? false : typeof v !== "string" || v.trim() === "") missing.push(f.key);
    }
  }
  return missing;
}

/** Display name for an actor id: "You", a directory name, or a generic label. Never a raw id. */
export function personLabel(id: string, actorId: string | null, names: Record<string, string>, you: string, another: string): string {
  if (actorId !== null && id === actorId) return you;
  const n = names[id];
  return n && n.trim() !== "" ? n : another;
}

export type PolicyRequest = {
  id: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  reason: string;
  requestedBy: string;
  requestedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
};

export type PolicySettings = {
  requireProductionApproval: boolean;
  version: number | null;
  isDefault: boolean;
  pendingPolicyChange: PolicyRequest | null;
};

/**
 * Mirrors the server: secrets are always sensitive; when the schema marks no field
 * `sensitive`, every field is. Used to warn BEFORE a production edit that will send
 * the integration back to sandbox (the server decides).
 */
export function sensitiveKeySet(fields: readonly FieldDef[]): Set<string> {
  const anyMarked = fields.some((f) => f.sensitive === true);
  return new Set((anyMarked ? fields.filter((f) => f.sensitive === true || f.secret) : fields).map((f) => f.key));
}

export function editTouchesSensitive(
  fields: readonly FieldDef[],
  stored: Record<string, unknown> | undefined,
  values: FormValues,
  secretInputs: Record<string, string>,
  clearing: readonly string[],
): boolean {
  if (clearing.length > 0 || Object.values(secretInputs).some((v) => v !== "")) return true;
  const sens = sensitiveKeySet(fields);
  const next = buildSaveBody({ fields, values, secretInputs: {}, clearSecrets: [], enabled: true }).config as Record<string, unknown>;
  for (const f of fields) {
    if (f.secret || !sens.has(f.key)) continue;
    if (JSON.stringify(stored?.[f.key] ?? null) !== JSON.stringify(next[f.key] ?? null)) return true;
  }
  return false;
}

// ── status vocabulary ────────────────────────────────────────────────────────

export type PillTone = "good" | "warn" | "mut" | "bad" | "info";

export function providerStatusTone(s: ProviderStatus): PillTone {
  return s === "available" ? "good" : s === "beta" ? "warn" : "mut";
}

export function healthTone(h: Health["status"]): PillTone {
  return h === "success" ? "good" : h === "failure" ? "bad" : "mut";
}

export function envTone(e: IntegrationEnv): PillTone {
  return e === "production" ? "bad" : "info";
}

/** Short availability summary pieces for the catalogue list. */
export function availabilityParts(a: PlatformProvider["availability"]): { all: boolean; tenants: number; editions: string[] } {
  return a.mode === "all" ? { all: true, tenants: 0, editions: [] } : { all: false, tenants: a.tenantIds.length, editions: a.editions };
}

/** Can this record be switched to production from the UI's point of view (server re-checks)? */
export function canRequestProduction(record: TenantRecord): boolean {
  return record.environment === "sandbox"
    && record.providerStatus === "available"
    && record.pendingSwitch == null
    && record.missingRequired.production.length === 0;
}

// ── async write handling ─────────────────────────────────────────────────────

/** Fresh key per user action so a double-click or a retry collapses to one request server-side. */
export function newIdempotencyKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Writes are accepted with 202 and applied by a consumer, so the UI polls the
 * read until `done(value)` holds, instead of claiming success on the 202.
 * Resolves with the last value read and whether the condition was met.
 */
export async function pollUntil<T>(
  read: () => Promise<T | null>,
  done: (v: T) => boolean,
  opts: { tries?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<{ value: T | null; settled: boolean }> {
  const tries = opts.tries ?? 8;
  const delayMs = opts.delayMs ?? 500;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let last: T | null = null;
  for (let i = 0; i < tries; i++) {
    last = await read();
    if (last !== null && done(last)) return { value: last, settled: true };
    if (i < tries - 1) await sleep(delayMs);
  }
  return { value: last, settled: false };
}
