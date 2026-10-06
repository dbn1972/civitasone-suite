/**
 * tenant route-group server loaders. Call tenant-service through the gateway
 * (/api/v1/tenant/*) using the shared cookie-aware fetchJson helper.
 */
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import type { ModuleRowSummary } from "@civitasone/types";
import { formatIndianDate, formatMoney, formatMoneyIn } from "@/lib/formatters";
import { z } from "zod";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toText(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function extractRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.resources)) return payload.resources;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.domains)) return payload.domains;
  if (Array.isArray(payload.assets)) return payload.assets;
  if (Array.isArray(payload.requests)) return payload.requests;
  if (Array.isArray(payload.values)) return payload.values;
  if (isRecord(payload.data)) return [payload.data];
  return [payload];
}

function mapTenantRows(payload: unknown): ModuleRowSummary[] {
  const mapped: ModuleRowSummary[] = [];
  for (const [index, row] of extractRows(payload).entries()) {
    if (!isRecord(row)) continue;
    const id =
      toText(row.id) ??
      toText(row.resource) ??
      toText(row.key) ??
      toText(row.code) ??
      toText(row.planId) ??
      toText(row.subscriptionId) ??
      `row-${index + 1}`;
    const label =
      toText(row.name) ??
      toText(row.title) ??
      toText(row.label) ??
      toText(row.key) ??
      toText(row.resource) ??
      toText(row.code) ??
      toText(row.domain) ??
      id;
    const sublabel =
      toText(row.description) ??
      toText(row.type) ??
      toText(row.category) ??
      toText(row.planName) ??
      toText(row.value);
    const status = toText(row.status) ?? toText(row.state);
    const meta =
      toText(row.code) ??
      toText(row.unit) ??
      (typeof row.usagePercent === "number" ? `${row.usagePercent}%` : undefined) ??
      (typeof row.limit === "number" ? `limit ${row.limit}` : undefined) ??
      toText(row.currency);
    mapped.push({
      id,
      label,
      ...(sublabel ? { sublabel } : {}),
      ...(status ? { status } : {}),
      ...(meta ? { meta } : {}),
    });
  }
  return mapped;
}

// ──────────────────────────────────────────────────────────────────────────
// Per-route mappers (gap-ledger tenant batch 2). mapTenantRows is a generic
// best-effort fallback shared by many routes; it drops real columns when a
// row has several candidate fields (e.g. a quota row with a `unit` loses its
// usagePercent/limit, a setting with a `description` hides its `value`). Each
// mapper below is route-specific, validates its own payload shape with zod,
// and packs the right data into the fixed ModuleRowSummary shape
// (label / sublabel / status / meta) without changing the shared table.
// ──────────────────────────────────────────────────────────────────────────

/** Human-readable form of a raw snake_case value: "near_limit" -> "Near limit". */
function humanize(value: string): string {
  const s = value.trim().replace(/[_-]+/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// GAP-TENANT-QUOTAS-01 / QUOTAS-02: /api/v1/tenant/usage returns
// { resources: [{ resource, limit, used, usagePercent, overLimit }] }.
const quotaUsageSchema = z.object({
  resources: z
    .array(
      z.object({
        resource: z.string(),
        limit: z.number().nullish(),
        used: z.number().nullish(),
        usagePercent: z.number().nullish(),
        overLimit: z.boolean().nullish(),
      }),
    )
    .default([]),
});

export function mapQuotaRows(payload: unknown): ModuleRowSummary[] {
  const parsed = quotaUsageSchema.safeParse(payload);
  const resources = parsed.success ? parsed.data.resources : [];
  return resources.map((r, index) => {
    const hasUsed = typeof r.used === "number";
    const hasLimit = typeof r.limit === "number";
    // "40 / 100" when both known; "—" when neither is (don't fabricate zero).
    const usedLimit = hasUsed || hasLimit ? `${hasUsed ? r.used : "—"} / ${hasLimit ? r.limit : "—"}` : "—";
    const percent =
      typeof r.usagePercent === "number"
        ? r.usagePercent
        : hasUsed && hasLimit && (r.limit as number) > 0
          ? Math.round(((r.used as number) / (r.limit as number)) * 100)
          : undefined;
    // GAP-TENANT-QUOTAS-02: readable status with a text cue (not colour-only).
    const status = r.overLimit
      ? "Exceeded"
      : typeof percent === "number" && percent >= 90
        ? "Near limit"
        : "OK";
    return {
      id: r.resource || `row-${index + 1}`,
      label: humanize(r.resource),
      sublabel: usedLimit,
      status,
      ...(typeof percent === "number" ? { meta: `${percent}%` } : {}),
    };
  });
}

// GAP-TENANT-SETTINGS-02 / SETTINGS-01: /api/v1/tenant/settings returns
// SettingView[] = [{ id, key, value, ... }]. The value must surface in its
// own column (meta) and NEVER be hidden behind a description; secret-looking
// keys are masked so credentials are not printed to every reader.
const settingSchema = z.object({
  id: z.string().optional(),
  key: z.string(),
  value: z.unknown().optional(),
  description: z.string().optional(),
  type: z.string().optional(),
  category: z.string().optional(),
});

// A key whose value is a credential/secret and must be masked in the UI.
const SECRET_KEY_RE = /(secret|password|passwd|token|api[_-]?key|private[_-]?key|credential)/i;

function stringifySettingValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value.trim() || "—";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "—";
  }
}

export function mapSettingRows(payload: unknown): ModuleRowSummary[] {
  const rows = extractRows(payload);
  const mapped: ModuleRowSummary[] = [];
  for (const [index, raw] of rows.entries()) {
    const parsed = settingSchema.safeParse(raw);
    if (!parsed.success) continue;
    const s = parsed.data;
    const secret = SECRET_KEY_RE.test(s.key);
    const value = secret ? "••••••••" : stringifySettingValue(s.value);
    mapped.push({
      id: s.id ?? s.key ?? `row-${index + 1}`,
      label: s.key,
      ...(s.description ?? s.type ?? s.category
        ? { sublabel: s.description ?? s.type ?? s.category }
        : {}),
      meta: value,
    });
  }
  return mapped;
}

// GAP-TENANT-SUBSCRIPTIONS-01 / SUBSCRIPTIONS-05: /api/v1/tenant/subscription/current
// returns { data: { planId, status, currentPeriodEnd, endDate, ... } }. Lead
// with the plan, show the renewal date and (when present) the amount in paise.
const subscriptionSchema = z.object({
  planId: z.string().optional(),
  planName: z.string().optional(),
  status: z.string().optional(),
  currentPeriodEnd: z.string().optional(),
  endDate: z.string().nullish(),
  renewsAt: z.string().nullish(),
  amountPaise: z.union([z.string(), z.number()]).nullish(),
  currency: z.string().nullish(),
});

export function mapSubscriptionRows(payload: unknown): ModuleRowSummary[] {
  const rows = extractRows(payload);
  const mapped: ModuleRowSummary[] = [];
  for (const [index, raw] of rows.entries()) {
    const parsed = subscriptionSchema.safeParse(raw);
    if (!parsed.success) continue;
    const s = parsed.data;
    const renewal = s.renewsAt ?? s.currentPeriodEnd ?? s.endDate ?? null;
    const renewalText = renewal ? `Renews ${formatIndianDate(renewal)}` : "—";
    // Money is paise; render through the paise-correct formatter (no float math).
    const amount =
      s.amountPaise !== null && s.amountPaise !== undefined
        ? s.currency
          ? formatMoneyIn(s.amountPaise, s.currency)
          : formatMoney(s.amountPaise)
        : undefined;
    mapped.push({
      id: s.planId ?? `row-${index + 1}`,
      // Never show a raw opaque id as the primary label when a plan name exists.
      label: s.planName ?? s.planId ?? `Subscription ${index + 1}`,
      ...(amount ? { sublabel: amount } : {}),
      ...(s.status ? { status: humanize(s.status) } : {}),
      meta: renewalText,
    });
  }
  return mapped;
}

// GAP-TENANT-STEWARDSHIP-01: /api/v1/tenant/data-governance/domains returns
// { data: [{ name, description, ownerOffice, ownerRole, classification }] }.
// Accountability (the owner) must be visible; show "Unassigned" when absent.
const domainSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  code: z.string().optional(),
  description: z.string().optional(),
  ownerOffice: z.string().optional(),
  ownerRole: z.string().optional(),
  steward: z.string().optional(),
  classification: z.string().optional(),
});

export function mapStewardshipRows(payload: unknown): ModuleRowSummary[] {
  const rows = extractRows(payload);
  const mapped: ModuleRowSummary[] = [];
  for (const [index, raw] of rows.entries()) {
    const parsed = domainSchema.safeParse(raw);
    if (!parsed.success) continue;
    const d = parsed.data;
    const owner =
      d.steward ??
      [d.ownerRole, d.ownerOffice].filter(Boolean).join(" · ") ??
      undefined;
    mapped.push({
      id: d.id ?? d.code ?? d.name ?? `row-${index + 1}`,
      label: d.name ?? d.code ?? `Domain ${index + 1}`,
      ...(d.description ? { sublabel: d.description } : {}),
      ...(d.classification ? { status: humanize(d.classification) } : {}),
      meta: owner && owner.length > 0 ? owner : "Unassigned",
    });
  }
  return mapped;
}

// GAP-TENANT-POSITIONS-01: /api/v1/tenant/positions returns
// { data: [{ title, code, grade, status, sanctionedStrength, filledStrength }] }.
// Show a Vacant indicator when the post has no incumbent (filled strength 0).
const positionSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  name: z.string().optional(),
  code: z.string().optional(),
  grade: z.string().optional(),
  status: z.string().optional(),
  sanctionedStrength: z.number().nullish(),
  filledStrength: z.number().nullish(),
});

export function mapPositionRows(payload: unknown): ModuleRowSummary[] {
  const rows = extractRows(payload);
  const mapped: ModuleRowSummary[] = [];
  for (const [index, raw] of rows.entries()) {
    const parsed = positionSchema.safeParse(raw);
    if (!parsed.success) continue;
    const p = parsed.data;
    const filled = typeof p.filledStrength === "number" ? p.filledStrength : undefined;
    const sanctioned = typeof p.sanctionedStrength === "number" ? p.sanctionedStrength : undefined;
    const vacant = filled === 0;
    const status = vacant ? "Vacant" : p.status ? humanize(p.status) : undefined;
    const strength =
      filled !== undefined || sanctioned !== undefined
        ? `${filled ?? "—"} / ${sanctioned ?? "—"} filled`
        : undefined;
    mapped.push({
      id: p.id ?? p.code ?? p.title ?? `row-${index + 1}`,
      label: p.title ?? p.name ?? p.code ?? `Position ${index + 1}`,
      ...(p.code || p.grade
        ? { sublabel: [p.code, p.grade].filter(Boolean).join(" · ") }
        : {}),
      ...(status ? { status } : {}),
      ...(strength ? { meta: strength } : {}),
    });
  }
  return mapped;
}

// GAP-TENANT-CONSENT-EXCHANGE-01 / CONSENT-EXCHANGE-02: /api/v1/tenant/consent/requests
// returns { data: ConsentArtefact[] } where each artefact carries purpose,
// requesting/providing departments, data categories and an expiry. The old
// generic mapper dropped all of that and fell back to the raw request UUID as
// the Name. Surface the purpose + requesting dept as the label, the data
// categories as the detail, and the expiry as meta. NEVER use the UUID as a
// human label (DPDP review needs the purpose, not an opaque id).
const consentSchema = z.object({
  id: z.string().optional(),
  purposeKey: z.string().optional(),
  requestingDept: z.string().optional(),
  providingDept: z.string().optional(),
  dataCategories: z.array(z.string()).default([]),
  validTo: z.string().nullish(),
  status: z.string().optional(),
});

export function mapConsentRows(payload: unknown): ModuleRowSummary[] {
  const rows = extractRows(payload);
  const mapped: ModuleRowSummary[] = [];
  for (const [index, raw] of rows.entries()) {
    const parsed = consentSchema.safeParse(raw);
    if (!parsed.success) continue;
    const c = parsed.data;
    // Label = humanised purpose (+ requesting dept), never the request UUID.
    const purpose = c.purposeKey ? humanize(c.purposeKey) : undefined;
    const label = purpose
      ? c.requestingDept
        ? `${purpose} — ${c.requestingDept}`
        : purpose
      : `Consent request ${index + 1}`;
    const categories = c.dataCategories.length > 0 ? c.dataCategories.join(", ") : undefined;
    const expiry = c.validTo ? `Expires ${formatIndianDate(c.validTo)}` : undefined;
    mapped.push({
      id: c.id ?? `row-${index + 1}`,
      label,
      ...(categories ? { sublabel: categories } : {}),
      ...(c.status ? { status: humanize(c.status) } : {}),
      ...(expiry ? { meta: expiry } : {}),
    });
  }
  return mapped;
}

// GAP-TENANT-DATA-MIGRATION-01: /api/v1/tenant/org/migrations returns
// { data: Migration[] } with recordsMigrated, errors[], dryRun and status.
// The old mapper showed only name + status. Surface records migrated and the
// error count so a data-integrity job's outcome is visible at a glance.
const migrationSchema = z.object({
  id: z.string().optional(),
  status: z.string().optional(),
  recordsMigrated: z.number().nullish(),
  dryRun: z.union([z.string(), z.boolean()]).nullish(),
  errors: z.array(z.unknown()).nullish(),
  entities: z.array(z.string()).nullish(),
  completedAt: z.string().nullish(),
});

export function mapMigrationRows(payload: unknown): ModuleRowSummary[] {
  const rows = extractRows(payload);
  const mapped: ModuleRowSummary[] = [];
  for (const [index, raw] of rows.entries()) {
    const parsed = migrationSchema.safeParse(raw);
    if (!parsed.success) continue;
    const m = parsed.data;
    const isDryRun = m.dryRun === true || m.dryRun === "true";
    const entities = m.entities && m.entities.length > 0 ? m.entities.join(", ") : undefined;
    const errorCount = Array.isArray(m.errors) ? m.errors.length : 0;
    const records = typeof m.recordsMigrated === "number" ? m.recordsMigrated : undefined;
    // Meta leads with the real counts; never fabricate a 0 when unknown.
    const metaParts: string[] = [];
    if (records !== undefined) metaParts.push(`${records} migrated`);
    if (errorCount > 0) metaParts.push(`${errorCount} error${errorCount === 1 ? "" : "s"}`);
    const status = m.status ? (isDryRun ? `${humanize(m.status)} (dry run)` : humanize(m.status)) : undefined;
    mapped.push({
      id: m.id ?? `row-${index + 1}`,
      label: entities ?? `Migration ${index + 1}`,
      ...(entities ? {} : {}),
      ...(status ? { status } : {}),
      ...(metaParts.length > 0 ? { meta: metaParts.join(" · ") } : {}),
    });
  }
  return mapped;
}

// GAP-TENANT-CODE-LISTS-01: /api/v1/tenant/code-lists returns code list
// headers { id, code, name, description, isSystem }. Surface the code (as the
// detail) and whether it's a platform/system list so the reference data is
// identifiable. (The per-value drill-down with effective dates is tracked as a
// follow-up — see the HUMAN REVIEW note; this stops the subtitle over-promising
// by mapping the real header fields.)
const codeListSchema = z.object({
  id: z.string().optional(),
  code: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  isSystem: z.boolean().nullish(),
});

export function mapCodeListRows(payload: unknown): ModuleRowSummary[] {
  const rows = extractRows(payload);
  const mapped: ModuleRowSummary[] = [];
  for (const [index, raw] of rows.entries()) {
    const parsed = codeListSchema.safeParse(raw);
    if (!parsed.success) continue;
    const l = parsed.data;
    mapped.push({
      id: l.id ?? l.code ?? `row-${index + 1}`,
      label: l.name ?? l.code ?? `Code list ${index + 1}`,
      ...(l.description ?? l.code ? { sublabel: l.description ?? l.code } : {}),
      ...(l.isSystem != null ? { status: l.isSystem ? "System" : "Custom" } : {}),
      ...(l.code ? { meta: l.code } : {}),
    });
  }
  return mapped;
}

// GAP-TENANT-PLANS-01: /api/v1/tenant/plans returns Plan[] with priceMinor
// (paise, bigint), enabledModules[] and edition. Render the price through the
// paise-correct money formatter (NEVER float math) and show the module count
// so the plans page delivers the "pricing and module entitlements" it promises.
const planSchema = z.object({
  id: z.string().optional(),
  code: z.string().optional(),
  name: z.string().optional(),
  edition: z.string().optional(),
  priceMinor: z.union([z.string(), z.number(), z.bigint()]).nullish(),
  billingCycle: z.string().optional(),
  enabledModules: z.array(z.string()).default([]),
});

export function mapPlanRows(payload: unknown): ModuleRowSummary[] {
  const rows = extractRows(payload);
  const mapped: ModuleRowSummary[] = [];
  for (const [index, raw] of rows.entries()) {
    const parsed = planSchema.safeParse(raw);
    if (!parsed.success) continue;
    const p = parsed.data;
    // priceMinor is paise; format via formatMoney (bigint-safe, no float div).
    const price =
      p.priceMinor !== null && p.priceMinor !== undefined
        ? `${formatMoney(typeof p.priceMinor === "bigint" ? p.priceMinor.toString() : p.priceMinor)}${p.billingCycle ? ` / ${p.billingCycle}` : ""}`
        : undefined;
    const moduleCount = p.enabledModules.length;
    const modules = moduleCount > 0 ? `${moduleCount} module${moduleCount === 1 ? "" : "s"}` : undefined;
    mapped.push({
      id: p.id ?? p.code ?? `row-${index + 1}`,
      label: p.name ?? p.code ?? `Plan ${index + 1}`,
      ...(price ? { sublabel: price } : {}),
      ...(p.edition ? { status: humanize(p.edition) } : {}),
      ...(modules ? { meta: modules } : {}),
    });
  }
  return mapped;
}

// GAP-TENANT-ORG-HIERARCHY-01: /api/v1/tenant/org/hierarchy returns org units
// with parentId + level. The old flat mapper dropped the hierarchy entirely.
// Build depth from parentId and indent the name so the tree is legible in the
// existing table (a full <OrgTree> is a follow-up — see HUMAN REVIEW).
const orgUnitSchema = z.object({
  id: z.string(),
  parentId: z.string().nullish(),
  name: z.string().optional(),
  code: z.string().optional(),
  type: z.string().optional(),
  level: z.number().nullish(),
});

export function mapOrgHierarchyRows(payload: unknown): ModuleRowSummary[] {
  const rows = extractRows(payload);
  const parsed = rows
    .map((r) => orgUnitSchema.safeParse(r))
    .filter((p): p is z.SafeParseSuccess<z.infer<typeof orgUnitSchema>> => p.success)
    .map((p) => p.data);
  // Compute depth from the parent chain so children indent under their parent.
  const byId = new Map(parsed.map((u) => [u.id, u]));
  const depthOf = (u: (typeof parsed)[number]): number => {
    let depth = 0;
    let cur: string | null | undefined = u.parentId;
    const seen = new Set<string>();
    while (cur && byId.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      depth += 1;
      cur = byId.get(cur)?.parentId;
    }
    return depth;
  };
  return parsed.map((u, index) => {
    const depth = typeof u.level === "number" && u.level > 0 ? u.level - 1 : depthOf(u);
    const indent = depth > 0 ? `${"\u00A0\u00A0".repeat(depth)}↳ ` : "";
    return {
      id: u.id ?? u.code ?? `row-${index + 1}`,
      label: `${indent}${u.name ?? u.code ?? `Unit ${index + 1}`}`,
      ...(u.type ? { sublabel: humanize(u.type) } : {}),
      ...(u.code ? { meta: u.code } : {}),
    };
  });
}

// GAP-TENANT-OVERVIEW-01 / OVERVIEW-02: /api/v1/tenant/current returns a single
// tenant profile object. The generic extractRows wraps it as a one-row list
// and the old mapper could fall back to the raw tenant UUID as the Name. Map
// the real profile fields (name, type/edition, status, code) and NEVER show a
// UUID as a name — fall back to "Unnamed", not the id.
const overviewSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  code: z.string().optional(),
  type: z.string().optional(),
  edition: z.string().optional(),
  status: z.string().optional(),
  residency: z.string().optional(),
  isolation: z.string().optional(),
});

export function mapOverviewRows(payload: unknown): ModuleRowSummary[] {
  const rows = extractRows(payload);
  const mapped: ModuleRowSummary[] = [];
  for (const [index, raw] of rows.entries()) {
    const parsed = overviewSchema.safeParse(raw);
    if (!parsed.success) continue;
    const t = parsed.data;
    const detailParts = [t.edition ?? t.type, t.residency, t.isolation].filter(Boolean) as string[];
    mapped.push({
      id: t.id ?? t.code ?? `row-${index + 1}`,
      // GAP-TENANT-OVERVIEW-02: never surface a UUID as the display name.
      label: t.name ?? "Unnamed",
      ...(detailParts.length > 0 ? { sublabel: detailParts.map(humanize).join(" · ") } : {}),
      ...(t.status ? { status: humanize(t.status) } : {}),
      ...(t.code ? { meta: t.code } : {}),
    });
  }
  return mapped;
}

function tenantLoader(
  path: string,
  key: string,
  mapper: (payload: unknown) => ModuleRowSummary[] = mapTenantRows,
) {
  return (): Promise<LoaderResult<ModuleRowSummary[]>> =>
    fetchJson<unknown, ModuleRowSummary[]>(path, [] as ModuleRowSummary[], {
      revalidateSeconds: 30,
      telemetryKey: key,
      mapResponse: mapper,
    });
}

/** Core tenant profile (11th backend module). */
export const getTenantOverview = tenantLoader("/api/v1/tenant/current", "tenant.overview", mapOverviewRows);
export const getTenantQuotas = tenantLoader("/api/v1/tenant/usage", "tenant.quotas", mapQuotaRows);
export const getTenantSettings = tenantLoader("/api/v1/tenant/settings", "tenant.settings", mapSettingRows);
export const getTenantOrgHierarchy = tenantLoader("/api/v1/tenant/org/hierarchy", "tenant.org-hierarchy", mapOrgHierarchyRows);
export const getTenantSubscriptions = tenantLoader(
  "/api/v1/tenant/subscription/current",
  "tenant.subscriptions",
  mapSubscriptionRows,
);
export const getTenantCodeLists = tenantLoader("/api/v1/tenant/code-lists", "tenant.code-lists", mapCodeListRows);
export const getTenantPositions = tenantLoader("/api/v1/tenant/positions", "tenant.positions", mapPositionRows);
export const getTenantConsentExchange = tenantLoader(
  "/api/v1/tenant/consent/requests",
  "tenant.consent-exchange",
  mapConsentRows,
);
export const getTenantStewardship = tenantLoader(
  "/api/v1/tenant/data-governance/domains",
  "tenant.stewardship",
  mapStewardshipRows,
);
export const getTenantDataMigration = tenantLoader(
  "/api/v1/tenant/org/migrations",
  "tenant.data-migration",
  mapMigrationRows,
);
export const getTenantPlans = tenantLoader("/api/v1/tenant/plans", "tenant.plans", mapPlanRows);
