/** Pure model of GET /v1/asset/settings (asset-service enterprise routes): the per-tenant GL account mapping. */
export type HeadField =
  | "cwipAccountCode" | "fixedAssetAccountCode" | "impairmentExpenseAccountCode" | "revaluationReserveAccountCode"
  | "grnClearingAccountCode" | "acquisitionOffsetAccountCode" | "maintenanceExpenseAccountCode" | "apControlAccountCode"
  | "rouAccountCode" | "leaseLiabilityAccountCode" | "leaseOffsetAccountCode";

export const HEAD_FIELDS: ReadonlyArray<{ field: HeadField; labelKey: "cwip" | "fixedAsset" | "impairmentExpense" | "revaluationReserve" | "grnClearing" | "acquisitionOffset" | "maintenanceExpense" | "apControl" | "rou" | "leaseLiability" | "leaseOffset" }> = [
  { field: "fixedAssetAccountCode", labelKey: "fixedAsset" },
  { field: "acquisitionOffsetAccountCode", labelKey: "acquisitionOffset" },
  { field: "grnClearingAccountCode", labelKey: "grnClearing" },
  { field: "maintenanceExpenseAccountCode", labelKey: "maintenanceExpense" },
  { field: "apControlAccountCode", labelKey: "apControl" },
  { field: "cwipAccountCode", labelKey: "cwip" },
  { field: "impairmentExpenseAccountCode", labelKey: "impairmentExpense" },
  { field: "revaluationReserveAccountCode", labelKey: "revaluationReserve" },
  { field: "rouAccountCode", labelKey: "rou" },
  { field: "leaseLiabilityAccountCode", labelKey: "leaseLiability" },
  { field: "leaseOffsetAccountCode", labelKey: "leaseOffset" },
];

/** The head KINDS asset-service reports as unset, and the translation key of each kind's field label. */
export type HeadKind =
  | "cwip" | "fixed_asset" | "impairment_expense" | "revaluation_reserve" | "rou" | "lease_liability" | "lease_offset"
  | "grn_clearing" | "acquisition_offset" | "maintenance_expense" | "ap_control";
export type GlArea = "acquisition" | "grn" | "maintenance" | "capitalisation" | "leases" | "impairment" | "revaluation";

export const KIND_LABEL_KEY: Record<HeadKind, (typeof HEAD_FIELDS)[number]["labelKey"]> = {
  cwip: "cwip", fixed_asset: "fixedAsset", impairment_expense: "impairmentExpense", revaluation_reserve: "revaluationReserve",
  rou: "rou", lease_liability: "leaseLiability", lease_offset: "leaseOffset",
  grn_clearing: "grnClearing", acquisition_offset: "acquisitionOffset", maintenance_expense: "maintenanceExpense", ap_control: "apControl",
};

export type AccountingStatus = Partial<Record<GlArea, { configured: boolean; missing: HeadKind[] }>>;
export type GlOpen = { assetsAwaiting: number; assetsFailed: number; workOrdersAwaiting: number; workOrdersFailed: number };

export type RequestKind = "maker_checker_off" | "gl_maker_checker_off" | "gl_heads_change";
export type PendingRequest = {
  id: string; kind: RequestKind; reason: string; requestedByMe: boolean;
  /** For gl_heads_change: the requested accounts (field -> code, null = clear). */
  heads: Partial<Record<HeadField, string | null>>;
};

export type AssetSettings = {
  capitalizeMakerChecker: boolean;
  /** Per-tenant: a GL account change is a request a different administrator approves (default ON). */
  glMakerChecker: boolean;
  /** Records handled per "post pending" run; more than this and the screen says "N more waiting". */
  sweepLimit: number;
  pendingRequests: PendingRequest[];
  heads: Record<HeadField, string | null>;
  accounting: AccountingStatus;
  glOpen: GlOpen;
  pending: { id: string; requestedByMe: boolean } | null;
};

const AREAS: readonly GlArea[] = ["acquisition", "grn", "maintenance", "capitalisation", "leases", "impairment", "revaluation"];
const KINDS = Object.keys(KIND_LABEL_KEY) as HeadKind[];
const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : 0);

export function parseAccounting(v: unknown): AccountingStatus {
  const out: AccountingStatus = {};
  if (typeof v !== "object" || v === null) return out;
  for (const area of AREAS) {
    const a = (v as Record<string, unknown>)[area];
    if (typeof a !== "object" || a === null) continue;
    const missing = Array.isArray((a as { missing?: unknown }).missing)
      ? ((a as { missing: unknown[] }).missing.filter((k): k is HeadKind => typeof k === "string" && (KINDS as string[]).includes(k)))
      : [];
    out[area] = { configured: (a as { configured?: unknown }).configured === true && missing.length === 0, missing };
  }
  return out;
}

export function parseAssetSettings(payload: unknown): AssetSettings | null {
  if (typeof payload !== "object" || payload === null) return null;
  const o = payload as Record<string, unknown>;
  if (typeof o.capitalizeMakerChecker !== "boolean") return null;
  const head = (k: HeadField): string | null => (typeof o[k] === "string" && o[k] !== "" ? (o[k] as string) : null);
  const p = o.pendingMakerCheckerOff;
  const pending = typeof p === "object" && p !== null && typeof (p as { id?: unknown }).id === "string"
    ? { id: (p as { id: string }).id, requestedByMe: (p as { requestedByMe?: unknown }).requestedByMe === true }
    : null;
  const heads = {} as Record<HeadField, string | null>;
  for (const { field } of HEAD_FIELDS) heads[field] = head(field);
  const KINDS_REQ: readonly string[] = ["maker_checker_off", "gl_maker_checker_off", "gl_heads_change"];
  const pendingRequests: PendingRequest[] = (Array.isArray(o.pendingRequests) ? o.pendingRequests : []).flatMap((r): PendingRequest[] => {
    if (typeof r !== "object" || r === null) return [];
    const x = r as Record<string, unknown>;
    if (typeof x.id !== "string" || typeof x.kind !== "string" || !KINDS_REQ.includes(x.kind)) return [];
    const h: Partial<Record<HeadField, string | null>> = {};
    if (typeof x.heads === "object" && x.heads !== null) {
      for (const { field } of HEAD_FIELDS) {
        const v = (x.heads as Record<string, unknown>)[field];
        if (v === null || typeof v === "string") h[field] = v;
      }
    }
    return [{ id: x.id, kind: x.kind as RequestKind, reason: typeof x.reason === "string" ? x.reason : "", requestedByMe: x.requestedByMe === true, heads: h }];
  });
  const g = (typeof o.glOpen === "object" && o.glOpen !== null ? o.glOpen : {}) as Record<string, unknown>;
  return {
    capitalizeMakerChecker: o.capitalizeMakerChecker,
    glMakerChecker: o.glMakerChecker !== false, // an older server without the field behaves as ON (the safe default)
    sweepLimit: typeof o.sweepLimit === "number" && o.sweepLimit > 0 ? Math.trunc(o.sweepLimit) : 200,
    pendingRequests,
    heads,
    accounting: parseAccounting(o.accounting),
    glOpen: { assetsAwaiting: count(g.assetsAwaiting), assetsFailed: count(g.assetsFailed), workOrdersAwaiting: count(g.workOrdersAwaiting), workOrdersFailed: count(g.workOrdersFailed) },
    pending,
  };
}

/** The distinct heads still unset across the given posting areas (in first-seen order). */
export function missingForAreas(accounting: AccountingStatus, areas: readonly GlArea[]): HeadKind[] {
  const seen: HeadKind[] = [];
  for (const area of areas) for (const k of accounting[area]?.missing ?? []) if (!seen.includes(k)) seen.push(k);
  return seen;
}

const CODE_RE = /^[A-Za-z0-9._-]{1,16}$/;

/**
 * Builds the PATCH body from the edited fields: only heads that CHANGED are sent; an emptied field clears it (null).
 * Returns null when nothing changed or a code is malformed (caller shows the field error).
 */
export function headsPatch(
  current: Record<HeadField, string | null>, edited: Record<HeadField, string>,
): { patch: Partial<Record<HeadField, string | null>>; invalid: HeadField | null } | null {
  const patch: Partial<Record<HeadField, string | null>> = {};
  for (const { field } of HEAD_FIELDS) {
    const next = edited[field].trim();
    if (next === (current[field] ?? "")) continue;
    if (next !== "" && !CODE_RE.test(next)) return { patch: {}, invalid: field };
    patch[field] = next === "" ? null : next;
  }
  return Object.keys(patch).length === 0 ? null : { patch, invalid: null };
}
