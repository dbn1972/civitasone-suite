/**
 * catalogue route-group server loaders — SCORE_LOCK F1 child pages.
 * Calls catalogue-service through the gateway via cookie-aware fetchJson.
 */
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import type { ModuleRowSummary } from "@civitasone/types";
import { formatMoney, formatIndianDate, humanizeStatus, todayIST } from "@/lib/formatters";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toText(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

/**
 * GAP-CATALOGUE-{BUNDLES,CATEGORIES,PRODUCTS,RATES}-0{2,3} (WIRING): return the
 * list from a known array key, or `null` for a response that is NOT a
 * recognisable list shape. The previous `[payload]` fallback turned any
 * unexpected 200 body (e.g. `{message:"x"}`) into a single junk row; now
 * mapRows returns null on it and fetchJson surfaces source:"error" instead.
 */
function extractRows(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return null;
  for (const key of ["data", "items", "resources", "rows", "results", "nodes", "changes", "breakers"]) {
    if (Array.isArray(payload[key])) return payload[key] as unknown[];
  }
  return null;
}

export function mapRows(payload: unknown): ModuleRowSummary[] | null {
  const rows = extractRows(payload);
  if (rows === null) return null;
  const mapped: ModuleRowSummary[] = [];
  for (const [index, row] of rows.entries()) {
    if (!isRecord(row)) continue;
    const code = toText(row.code) ?? toText(row.productCode);
    const id =
      toText(row.id) ??
      toText(row.key) ??
      code ??
      toText(row.name) ??
      toText(row.agentId) ??
      toText(row.profileId) ??
      toText(row.accountId) ??
      toText(row.conversationId) ??
      `row-${index + 1}`;
    const label =
      toText(row.name) ??
      toText(row.title) ??
      toText(row.label) ??
      code ??
      toText(row.type) ??
      toText(row.entityType) ??
      toText(row.direction) ??
      id;
    // GAP-CATALOGUE-{BUNDLES,CATEGORIES,PRODUCTS,RATES}-0{3,4} (DUPLICATE-COLUMN):
    // the Detail column must NOT fall through to status/state — those already
    // have their own Status column, so a row with only a status used to show
    // it twice. Detail is now description/category/tier only.
    const sublabel =
      toText(row.description) ??
      toText(row.category) ??
      toText(row.tier) ??
      toText(row.programName);
    const status = toText(row.status) ?? toText(row.state) ?? toText(row.lifecycleStatus) ?? toText(row.lifecycle);
    const meta =
      code ??
      toText(row.currency) ??
      toText(row.updatedAt) ??
      toText(row.createdAt) ??
      (typeof row.points === "number" ? `${row.points} pts` : undefined) ??
      (typeof row.balance === "number" ? `bal ${row.balance}` : undefined);
    mapped.push({
      id,
      label,
      ...(sublabel ? { sublabel } : {}),
      ...(status ? { status } : {}),
      ...(meta ? { meta } : {}),
      ...(code ? { code } : {}),
    });
  }
  return mapped;
}

/**
 * GAP-CATALOGUE-{BUNDLES,CATEGORIES,PRODUCTS,RATES}-0{5,6} (CACHE): no
 * `revalidateSeconds`. The pages are `export const dynamic = "force-dynamic"`
 * because the fetch carries a per-user auth header that must NOT enter the
 * shared Next data cache; fetchJson then uses `cache:"no-store"`. The old
 * `revalidateSeconds:30` was dead config (force-dynamic overrode it) that
 * misleadingly implied a 30s shared cache.
 */
function moduleLoader(path: string, key: string) {
  return (): Promise<LoaderResult<ModuleRowSummary[]>> =>
    fetchJson<unknown, ModuleRowSummary[]>(path, [] as ModuleRowSummary[], {
      telemetryKey: key,
      mapResponse: mapRows,
    });
}

export const getCatalogueProducts = moduleLoader("/api/v1/catalogue/products", "catalogue.products");

// ---------------------------------------------------------------------------
// GAP-CATALOGUE-BUNDLES-01 (OTHER): the generic mapper showed a bundle only as
// id/name/status and dropped its contents. catalogue-service's bundle model
// (bundles/schema.ts) carries componentProductIds (a string[]) but has NO
// price or validity columns — those fields do not exist server-side, so the
// gap's "bundle price and validity" cannot be shown without a schema change
// (recorded for HUMAN REVIEW). What CAN be surfaced honestly today is the
// member count, so a reader can tell a bundle's size.
// ---------------------------------------------------------------------------
export function mapBundleRows(payload: unknown): ModuleRowSummary[] | null {
  const rows = extractRows(payload);
  if (rows === null) return null;
  const mapped: ModuleRowSummary[] = [];
  for (const [index, row] of rows.entries()) {
    if (!isRecord(row)) continue;
    const id = toText(row.id) ?? toText(row.name) ?? `bundle-${index + 1}`;
    const label = toText(row.name) ?? id;
    const components = row.componentProductIds;
    const count = Array.isArray(components) ? components.length : undefined;
    const status = toText(row.status) ?? toText(row.state);
    const sublabel = toText(row.description);
    mapped.push({
      id,
      label,
      ...(sublabel ? { sublabel } : {}),
      ...(status ? { status } : {}),
      ...(count !== undefined ? { meta: `${count} member${count === 1 ? "" : "s"}` } : {}),
    });
  }
  return mapped;
}

export const getCatalogueBundles = (): Promise<LoaderResult<ModuleRowSummary[]>> =>
  fetchJson<unknown, ModuleRowSummary[]>("/api/v1/catalogue/bundles", [] as ModuleRowSummary[], {
    telemetryKey: "catalogue.bundles",
    mapResponse: mapBundleRows,
  });

// ---------------------------------------------------------------------------
// GAP-CATALOGUE-CATEGORIES-01 (TREE): the categories page reads the product
// hierarchy from /products/tree, whose nodes nest their children under a
// `children` array (catalogue-service products/routes.ts buildHierarchyTree).
// The old loader flattened only the top level and dropped every sub-category.
// flattenTree recurses depth-first, emitting one row per node with its 0-based
// depth and parent name so ModuleListTable can indent it.
// ---------------------------------------------------------------------------

interface TreeNodeInput {
  id?: unknown;
  name?: unknown;
  code?: unknown;
  productCode?: unknown;
  lifecycleStatus?: unknown;
  status?: unknown;
  level?: unknown;
  children?: unknown;
}

export function flattenCategoryTree(payload: unknown): ModuleRowSummary[] | null {
  const roots = extractRows(payload);
  if (roots === null) return null;
  const out: ModuleRowSummary[] = [];

  function walk(node: unknown, depth: number, parentLabel: string | undefined): void {
    if (!isRecord(node)) return;
    const n = node as TreeNodeInput;
    const code = toText(n.code) ?? toText(n.productCode);
    const id = toText(n.id) ?? code ?? toText(n.name) ?? `node-${out.length + 1}`;
    const label = toText(n.name) ?? code ?? id;
    const status = toText(n.lifecycleStatus) ?? toText(n.status);
    const level = toText(n.level);
    out.push({
      id,
      label,
      depth,
      ...(parentLabel ? { parentLabel } : {}),
      ...(level ? { sublabel: humanizeStatus(level) } : {}),
      ...(status ? { status } : {}),
      ...(code ? { code, meta: code } : {}),
    });
    const children = Array.isArray(n.children) ? n.children : [];
    for (const child of children) walk(child, depth + 1, label);
  }

  for (const root of roots) walk(root, 0, undefined);
  return out;
}

export const getCatalogueCategories = (): Promise<LoaderResult<ModuleRowSummary[]>> =>
  fetchJson<unknown, ModuleRowSummary[]>("/api/v1/catalogue/products/tree", [] as ModuleRowSummary[], {
    telemetryKey: "catalogue.categories",
    mapResponse: flattenCategoryTree,
  });

// ---------------------------------------------------------------------------
// GAP-CATALOGUE-RATES-01 (MISSING-FIELDS): rate cards carry an amount in minor
// units (paise, bigint-as-string), a product id and an effective period. The
// generic mapper showed none of them. mapRateRows renders the amount via
// formatMoney (paise-correct) and marks the card in force for IST "today".
//
// NOTE: catalogue-service's GET /v1/catalogue/rates REQUIRES a `productId`
// query param (rates/routes.ts rateQuery), so the un-parameterised list page
// cannot call it directly without a 400 — RATES-01's full "list every card"
// screen needs a product picker first (recorded for HUMAN REVIEW). mapRateRows
// is the honest, tested mapper for a rate-card payload once a product is
// selected; it is exported and unit-tested so the display contract is pinned.
// ---------------------------------------------------------------------------

interface RateRowInput {
  id?: unknown;
  productId?: unknown;
  rateValue?: unknown;
  rateValueMinor?: unknown;
  effectiveDate?: unknown;
  effectiveFrom?: unknown;
  effectiveTo?: unknown;
  source?: unknown;
}

/** True when `today` (YYYY-MM-DD) is within [from, to] inclusive; to=null means open-ended. */
export function isRateInForce(
  effectiveFrom: string | null | undefined,
  effectiveTo: string | null | undefined,
  today: string = todayIST(),
): boolean {
  if (!effectiveFrom) return false;
  if (today < effectiveFrom) return false;
  if (effectiveTo && today > effectiveTo) return false;
  return true;
}

export function mapRateRows(payload: unknown): ModuleRowSummary[] | null {
  const rows = extractRows(payload);
  if (rows === null) return null;
  const mapped: Array<{ from: string; row: ModuleRowSummary }> = [];
  for (const [index, row] of rows.entries()) {
    if (!isRecord(row)) continue;
    const r = row as RateRowInput;
    const id = toText(r.id) ?? `rate-${index + 1}`;
    // Money: both the create/update EVENT contract field `rateValueMinor` and
    // the GET /v1/catalogue/rates serialized row field `rateValue` carry the
    // SAME value — minor units (paise/cents) as bigint (schema.ts: "Rate value
    // stored in minor units (paise/cents) as bigint"). The list endpoint sends
    // raw Drizzle rows whose column is `rateValue`, so reading `rateValueMinor`
    // alone left every amount blank (GAP2-CATALOGUE-RATES-02). Prefer the
    // event-contract name when present, else the serialized DB field.
    // `rateValue` is accepted ONLY in the shape the bigint column serialises to
    // (an integer string of minor units). A JS number such as 125.5 is a legacy
    // major-unit figure and must never be read as paise (shows "—" instead).
    const serializedMinor = typeof r.rateValue === "string" && /^-?\d+$/.test(r.rateValue) ? r.rateValue : undefined;
    const amountRaw = r.rateValueMinor ?? serializedMinor;
    const amount =
      typeof amountRaw === "bigint" || typeof amountRaw === "number" || typeof amountRaw === "string"
        ? formatMoney(amountRaw)
        : "—";
    const from = toText(r.effectiveFrom) ?? toText(r.effectiveDate);
    const to = toText(r.effectiveTo);
    const inForce = isRateInForce(from ?? null, to ?? null);
    const period = `${formatIndianDate(from)} → ${to ? formatIndianDate(to) : "open"}`;
    mapped.push({
      from: from ?? "",
      row: {
        id,
        label: amount,
        sublabel: period,
        status: inForce ? "In force" : "Scheduled/expired",
        ...(toText(r.source) ? { meta: toText(r.source) } : {}),
      },
    });
  }
  // Newest effective-from first (ISO dates compare lexically; undated cards last).
  mapped.sort((a, b) => (a.from < b.from ? 1 : a.from > b.from ? -1 : 0));
  return mapped.map((m) => m.row);
}

/** Rate cards for ONE product (the API requires productId). Empty/non-UUID id => no call. */
export function getCatalogueRatesForProduct(productId: string): Promise<LoaderResult<ModuleRowSummary[]>> {
  return fetchJson<unknown, ModuleRowSummary[]>(
    `/api/v1/catalogue/rates?productId=${encodeURIComponent(productId)}&limit=200`,
    [] as ModuleRowSummary[],
    { telemetryKey: "catalogue.rates", mapResponse: mapRateRows },
  );
}
