/**
 * Product / Pricing / Quotation client (BRD §7.8, QP-001..QP-005).
 *
 * Routes through the BFF proxy via browserFetch. Read loaders return
 * { source: "error" } on failure so screens render "—" + DataSourceBadge
 * instead of fabricating an empty catalogue/quote as fact. Normalisers tolerate
 * bare-array or wrapped payloads (backend built concurrently).
 *
 * Money is minor units (paise) as an integer STRING throughout. Line totals are
 * computed with BigInt in lib/money helpers / formatters — never float math.
 */
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";

export type QpSource = "api" | "error";

export interface LoaderResult<T> {
  data: T;
  source: QpSource;
}

/* --------------------------------------------------------------- helpers -- */

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v) || 0;
}
function bool(v: unknown, dflt = false): boolean {
  return typeof v === "boolean" ? v : dflt;
}
function minorStr(v: unknown): string {
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(Math.round(v));
  return "0";
}
function toArray(raw: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    for (const k of ["items", "data", ...keys]) {
      const v = (raw as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

/* ======================================================= shared constants == */

/** QP-004 approval categories (single source of truth, shared with the UI). */
export const APPROVAL_TYPES = ["discount", "deviation"] as const;
export type ApprovalType = (typeof APPROVAL_TYPES)[number];

export const APPROVAL_TYPE_LABELS: Record<ApprovalType, string> = {
  discount: "Discount",
  deviation: "Deviation",
};

export const QUOTE_STATUSES = ["draft", "sent", "accepted", "rejected", "converted"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

/* ============================================================ QP-001 types == */

export interface Product {
  id?: string;
  category: string;
  code: string;
  name: string;
  unit: string;
  /** Tax rate in basis points (1 bp = 0.01%). */
  taxRateBps: number;
  /** Unit price in minor units (paise) as a string. */
  priceMinor: string;
  currency: string;
  activeFrom: string;
  activeTo: string;
  enabled: boolean;
}

export function normaliseProduct(raw: unknown): Product | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : undefined;
  const name = str(r.name);
  const code = str(r.code);
  if (!id && !name && !code) return null;
  return {
    id,
    category: str(r.category),
    code,
    name,
    unit: str(r.unit),
    taxRateBps: num(r.taxRateBps),
    priceMinor: minorStr(r.priceMinor ?? r.price),
    currency: str(r.currency) || "INR",
    activeFrom: str(r.activeFrom),
    activeTo: str(r.activeTo),
    enabled: bool(r.enabled, true),
  };
}

export function normaliseProducts(raw: unknown): Product[] {
  return toArray(raw, "products")
    .map(normaliseProduct)
    .filter((p): p is Product => p !== null);
}

/** True when the product is enabled and today falls in its active window. */
export function isProductSelectable(p: Product, now: Date = new Date()): boolean {
  if (!p.enabled) return false;
  const today = now.toISOString().slice(0, 10);
  if (p.activeFrom && today < p.activeFrom.slice(0, 10)) return false;
  if (p.activeTo && today > p.activeTo.slice(0, 10)) return false;
  return true;
}

export async function getProducts(): Promise<LoaderResult<Product[]>> {
  try {
    const res = await browserFetch("v1/crm/products");
    if (!res.ok) return { data: [], source: "error" };
    return { data: normaliseProducts(await res.json()), source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

export async function createProduct(p: Product): Promise<void> {
  const res = await browserFetch("v1/crm/products", { method: "POST", body: JSON.stringify(p) });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

export async function updateProduct(id: string, p: Product): Promise<void> {
  // PATCH, not PUT: the service registers only `app.patch("/v1/crm/products/:id")`,
  // so a PUT matched no route and Fastify answered 404 — product edits never saved.
  const res = await browserFetch(`v1/crm/products/${id}`, { method: "PATCH", body: JSON.stringify(p) });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

export async function deleteProduct(id: string): Promise<void> {
  const res = await browserFetch(`v1/crm/products/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

/* ============================================================ QP-002 types == */

export interface PriceBookEntry {
  productId: string;
  priceMinor: string;
}

export interface PriceBook {
  id?: string;
  name: string;
  segment: string;
  currency: string;
  geography: string;
  channel: string;
  entries: PriceBookEntry[];
  enabled: boolean;
}

export function normalisePriceBookEntry(raw: unknown): PriceBookEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const productId = str(r.productId);
  if (!productId) return null;
  return { productId, priceMinor: minorStr(r.priceMinor ?? r.price) };
}

export function normalisePriceBook(raw: unknown): PriceBook | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : undefined;
  const name = str(r.name);
  if (!id && !name) return null;
  return {
    id,
    name,
    segment: str(r.segment),
    currency: str(r.currency) || "INR",
    geography: str(r.geography),
    channel: str(r.channel),
    // The backend's actual field name is `items` (GET /v1/crm/price-books[/:id] attaches
    // `items`, never `entries` — see price-books/routes.ts) — `toArray` checks "items"
    // before any caller-supplied key, so pass the whole book object `r`, not `r.entries`
    // (which is always undefined against a real response and silently produced an empty
    // list). "entries" stays listed as a fallback for callers/tests using that name.
    entries: toArray(r, "items", "entries")
      .map(normalisePriceBookEntry)
      .filter((e): e is PriceBookEntry => e !== null),
    enabled: bool(r.enabled, true),
  };
}

export function normalisePriceBooks(raw: unknown): PriceBook[] {
  return toArray(raw, "priceBooks")
    .map(normalisePriceBook)
    .filter((p): p is PriceBook => p !== null);
}

export async function getPriceBooks(): Promise<LoaderResult<PriceBook[]>> {
  try {
    const res = await browserFetch("v1/crm/price-books");
    if (!res.ok) return { data: [], source: "error" };
    return { data: normalisePriceBooks(await res.json()), source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

export async function createPriceBook(p: PriceBook): Promise<void> {
  const res = await browserFetch("v1/crm/price-books", { method: "POST", body: JSON.stringify(p) });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

export async function updatePriceBook(id: string, p: PriceBook): Promise<void> {
  // PATCH, not PUT — the service registers `app.patch("/v1/crm/price-books/:id")`.
  // PUT on this path is only defined for `/:id/items`, so the header edit 404'd.
  const res = await browserFetch(`v1/crm/price-books/${id}`, { method: "PATCH", body: JSON.stringify(p) });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

export async function deletePriceBook(id: string): Promise<void> {
  const res = await browserFetch(`v1/crm/price-books/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

export interface ResolveQuery {
  segment?: string;
  currency?: string;
  geography?: string;
  channel?: string;
}

/** QP-002 resolve — which price book applies for the given criteria. */
export async function resolvePriceBook(q: ResolveQuery): Promise<LoaderResult<PriceBook | null>> {
  const params = new URLSearchParams();
  if (q.segment) params.set("segment", q.segment);
  if (q.currency) params.set("currency", q.currency);
  if (q.geography) params.set("geography", q.geography);
  if (q.channel) params.set("channel", q.channel);
  try {
    const res = await browserFetch(`v1/crm/price-books/resolve?${params.toString()}`);
    if (!res.ok) return { data: null, source: "error" };
    const body = await res.json();
    // Tolerate { priceBook } | { book } | a bare price-book object.
    const inner =
      body && typeof body === "object"
        ? ((body as Record<string, unknown>).priceBook ?? (body as Record<string, unknown>).book ?? body)
        : body;
    return { data: normalisePriceBook(inner), source: "api" };
  } catch {
    return { data: null, source: "error" };
  }
}

/* ============================================================ QP-003 types == */

export interface QuotationLine {
  productId: string;
  productName?: string;
  quantity: number;
  unitPriceMinor: string;
  taxRateBps: number;
}

export interface Quotation {
  id?: string;
  accountId?: string;
  opportunityId?: string;
  /**
   * Business reference shared by every version of the same quotation
   * (`quote_ref` server-side). Versions are grouped by it, so it must survive a
   * read/write round-trip.
   */
  quoteRef?: string;
  template: string;
  version: number;
  status: QuoteStatus;
  lines: QuotationLine[];
  /** Whether an unapproved discount/deviation is blocking send (QP-004). */
  approvalRequired?: boolean;
  approvalStatus?: string;
}

export function normaliseLine(raw: unknown): QuotationLine | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const productId = str(r.productId);
  if (!productId) return null;
  return {
    productId,
    // The service stores the line label as `description`; `productName` only
    // exists in the UI model, so a round-tripped line lost its label.
    productName: str(r.productName ?? r.description) || undefined,
    quantity: num(r.quantity),
    unitPriceMinor: minorStr(r.unitPriceMinor ?? r.unitPrice ?? r.priceMinor),
    taxRateBps: num(r.taxRateBps),
  };
}

export function normaliseQuotation(raw: unknown): Quotation | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : undefined;
  if (!id && !r.lines) return null;
  const status = str(r.status);
  return {
    id,
    accountId: str(r.accountId) || undefined,
    opportunityId: str(r.opportunityId ?? r.dealId) || undefined,
    quoteRef: str(r.quoteRef) || undefined,
    // The API field names are templateRef / versionNumber. Reading `template`
    // and `version` meant the template always rendered empty and every version
    // displayed as 1. Old names kept as a fallback for cached payloads.
    template: str(r.templateRef ?? r.template),
    version: num(r.versionNumber ?? r.version) || 1,
    status: (QUOTE_STATUSES as readonly string[]).includes(status) ? (status as QuoteStatus) : "draft",
    // toArray() looks the keys up ON the object it is given, so this has to be
    // handed `r`, not `r.lines`. Passing `r.lines` meant that whenever the API
    // returned `lineItems` (which is its actual field name) the value was
    // undefined and every quotation normalised to zero lines.
    lines: toArray(r, "lines", "lineItems")
      .map(normaliseLine)
      .filter((l): l is QuotationLine => l !== null),
    approvalRequired: bool(r.approvalRequired),
    approvalStatus: str(r.approvalStatus) || undefined,
  };
}

export function normaliseQuotations(raw: unknown): Quotation[] {
  return toArray(raw, "quotations")
    .map(normaliseQuotation)
    .filter((q): q is Quotation => q !== null);
}

/** Per-line net (qty * unit) in paise as a BigInt-safe string. */
export function lineNetMinor(line: QuotationLine): string {
  const unit = BigInt(minorStr(line.unitPriceMinor));
  const qty = BigInt(Math.max(0, Math.trunc(line.quantity)));
  return (unit * qty).toString();
}

/** Per-line tax (net * bps / 10000) in paise, rounded to the nearest paisa. */
export function lineTaxMinor(line: QuotationLine): string {
  const net = BigInt(lineNetMinor(line));
  const bps = BigInt(Math.max(0, Math.trunc(line.taxRateBps)));
  // net*bps/10000 with round-half-up.
  const numer = net * bps;
  const half = 10000n / 2n;
  return ((numer + half) / 10000n).toString();
}

/** Quotation grand total (sum of line net + tax) in paise as a string. */
export function quotationTotalMinor(lines: QuotationLine[]): string {
  let total = 0n;
  for (const l of lines) total += BigInt(lineNetMinor(l)) + BigInt(lineTaxMinor(l));
  return total.toString();
}

export async function getQuotations(): Promise<LoaderResult<Quotation[]>> {
  try {
    const res = await browserFetch("v1/crm/quotations");
    if (!res.ok) return { data: [], source: "error" };
    return { data: normaliseQuotations(await res.json()), source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

/**
 * Fetch one quotation.
 *
 * There is no `GET /v1/crm/quotations/:id`; the document endpoint is
 * `GET /:id/document`, which returns the header plus its relational line items.
 * This previously hit the bare `:id` path and always fell into the error branch.
 */
export async function getQuotation(id: string): Promise<LoaderResult<Quotation | null>> {
  try {
    const res = await browserFetch(`v1/crm/quotations/${id}/document`);
    if (!res.ok) return { data: null, source: "error" };
    const body = await res.json();
    const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const inner = rec.quotation ?? rec.data ?? body;
    return { data: normaliseQuotation(inner), source: "api" };
  } catch {
    return { data: null, source: "error" };
  }
}

/**
 * Map the UI's quotation model onto the service's line-item contract.
 *
 * The API requires `description` on every line; the builder only captures a
 * product, so the product name carries the description. `productId` and
 * `taxRateBps` are optional server-side but always present here.
 */
function toApiLineItems(lines: QuotationLine[]): Array<Record<string, unknown>> {
  return lines.map((l) => ({
    ...(l.productId ? { productId: l.productId } : {}),
    description: l.productName?.trim() || l.productId || "Item",
    quantity: l.quantity,
    unitPriceMinor: l.unitPriceMinor,
    taxRateBps: l.taxRateBps,
  }));
}

/**
 * Client-minted quotation reference.
 *
 * `quoteRef` is required by POST /v1/crm/quotations and the service does not
 * default it, unlike grievances and service requests which mint GRV/SRQ refs
 * server-side. Minting here unblocks quoting, but a tenant-scoped gapless series
 * belongs in crm-service for consistency and auditability — flagged in the PR.
 */
function mintQuoteRef(): string {
  return `QTN/${new Date().getFullYear()}/${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

/**
 * Create a quotation.
 *
 * Previously posted the raw UI model, which the request schema rejected: it
 * requires `quoteRef`, `templateRef` and `lineItems`, while the UI model carries
 * `template` and `lines` and no ref at all. So every create failed validation
 * with 400 — the builder could not produce a quotation.
 */
export async function createQuotation(q: Quotation): Promise<void> {
  const body = {
    ...(q.opportunityId ? { dealId: q.opportunityId } : {}),
    quoteRef: q.quoteRef ?? mintQuoteRef(),
    templateRef: q.template,
    lineItems: toApiLineItems(q.lines),
    totalMinor: quotationTotalMinor(q.lines),
  };
  const res = await browserFetch("v1/crm/quotations", { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

/**
 * Save changes to an existing quotation by superseding it with a new version.
 *
 * There is no update route: a quotation is a commercial document, so the service
 * models a change as `POST /:id/new-version`, which clones the header and takes
 * the revised line items. This helper used to PUT /v1/crm/quotations/:id, a path
 * that does not exist, so saving an edit always 404'd.
 */
export async function updateQuotation(id: string, q: Quotation): Promise<void> {
  const body = {
    lineItems: toApiLineItems(q.lines),
    totalMinor: quotationTotalMinor(q.lines),
  };
  const res = await browserFetch(`v1/crm/quotations/${id}/new-version`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

/**
 * QP-004: sending a quotation is blocked with 422 APPROVAL_REQUIRED when an
 * unapproved discount/deviation exists. We surface that honestly — never fake a
 * successful send.
 */
export class ApprovalRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalRequiredError";
  }
}

async function throwQuoteError(res: Response): Promise<never> {
  let body: unknown = null;
  try {
    body = await res.clone().json();
  } catch {
    /* no body */
  }
  const code =
    (body && typeof body === "object" && str((body as Record<string, unknown>).code)) || "";
  if (res.status === 422 && code === "APPROVAL_REQUIRED") {
    throw new ApprovalRequiredError(
      "This quotation has an unapproved discount or deviation. Get approval before sending.",
    );
  }
  throw new Error(await errorMessageFromResponse(res));
}

export async function sendQuotation(id: string): Promise<void> {
  const res = await browserFetch(`v1/crm/quotations/${id}/send`, { method: "POST" });
  if (!res.ok) await throwQuoteError(res);
}

export async function acceptQuotation(id: string): Promise<void> {
  const res = await browserFetch(`v1/crm/quotations/${id}/accept`, { method: "POST" });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

export async function rejectQuotation(id: string, reason: string): Promise<void> {
  const res = await browserFetch(`v1/crm/quotations/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

export async function newQuotationVersion(id: string): Promise<void> {
  const res = await browserFetch(`v1/crm/quotations/${id}/new-version`, { method: "POST" });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

export async function convertToOrder(id: string): Promise<void> {
  const res = await browserFetch(`v1/crm/quotations/${id}/convert-to-order`, { method: "POST" });
  if (!res.ok) await throwQuoteError(res);
}

/* ============================================================ QP-004 types == */

export interface ApprovalRequest {
  id?: string;
  quotationId: string;
  type: ApprovalType;
  /** For discounts: the discount in basis points. */
  amountBps?: number;
  reason: string;
  status: string;
}

export function normaliseApproval(raw: unknown): ApprovalRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const quotationId = str(r.quotationId);
  const type = str(r.type);
  if (!(APPROVAL_TYPES as readonly string[]).includes(type)) return null;
  return {
    id: typeof r.id === "string" ? r.id : undefined,
    quotationId,
    type: type as ApprovalType,
    amountBps: r.amountBps !== undefined ? num(r.amountBps) : undefined,
    reason: str(r.reason),
    status: str(r.status) || "pending",
  };
}

export function normaliseApprovals(raw: unknown): ApprovalRequest[] {
  return toArray(raw, "approvals")
    .map(normaliseApproval)
    .filter((a): a is ApprovalRequest => a !== null);
}

export async function getApprovals(quotationId: string): Promise<LoaderResult<ApprovalRequest[]>> {
  try {
    const res = await browserFetch(`v1/crm/quotations/${quotationId}/approvals`);
    if (!res.ok) return { data: [], source: "error" };
    return { data: normaliseApprovals(await res.json()), source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

export async function requestApproval(quotationId: string, req: Omit<ApprovalRequest, "id" | "quotationId" | "status">): Promise<void> {
  const res = await browserFetch(`v1/crm/quotations/${quotationId}/approvals`, {
    method: "POST",
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

/**
 * Decide a pending quotation approval.
 *
 * This used to POST `v1/crm/quotations/:id/approvals/:approvalId/approve`, a path
 * the service never exposed, so approving a discount request always 404'd. The
 * real endpoint is `POST /v1/crm/quotation-approvals/:approvalId/decide` and it
 * takes the decision in the body, which also makes reject reachable.
 *
 * `quotationId` is no longer part of the request — the approval id is globally
 * unique and the service resolves the quotation from it. The parameter is kept so
 * the existing call sites read naturally.
 */
export async function decideApprovalRequest(
  approvalId: string,
  decision: "approve" | "reject",
  reason?: string,
): Promise<void> {
  const res = await browserFetch(`v1/crm/quotation-approvals/${approvalId}/decide`, {
    method: "POST",
    body: JSON.stringify({ decision, ...(reason ? { reason } : {}) }),
  });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

export async function approveApproval(_quotationId: string, approvalId: string): Promise<void> {
  return decideApprovalRequest(approvalId, "approve");
}

export async function rejectApproval(approvalId: string, reason?: string): Promise<void> {
  return decideApprovalRequest(approvalId, "reject", reason);
}

/* ============================================================ QP-005 types == */

export interface QuotationVersion {
  version: number;
  status: QuoteStatus;
  totalMinor: string;
  createdAt: string;
  /** Shared business ref — versions of one quotation all carry the same value. */
  quoteRef?: string;
  /** Row id of this specific version. */
  id?: string;
}

export function normaliseVersions(raw: unknown): QuotationVersion[] {
  return toArray(raw, "versions", "history")
    .map((c): QuotationVersion | null => {
      if (!c || typeof c !== "object") return null;
      const r = c as Record<string, unknown>;
      // The API names this `versionNumber`; `version` kept as a fallback.
      const version = num(r.versionNumber ?? r.version);
      if (!version) return null;
      const status = str(r.status);
      return {
        version,
        status: (QUOTE_STATUSES as readonly string[]).includes(status) ? (status as QuoteStatus) : "draft",
        totalMinor: minorStr(r.totalMinor ?? r.total),
        createdAt: str(r.createdAt),
        ...(str(r.quoteRef) ? { quoteRef: str(r.quoteRef) } : {}),
        ...(typeof r.id === "string" ? { id: r.id } : {}),
      };
    })
    .filter((v): v is QuotationVersion => v !== null);
}

/**
 * Version history for a quotation.
 *
 * There is no `/:id/versions` route — that path 404'd, so the version panel was
 * always empty. Versions are rows in `crm.quotations` sharing a `quote_ref`, and
 * the list endpoint already orders by `quote_ref, version_number DESC`. So the
 * history is the list filtered to this quotation's ref.
 *
 * `quoteRef` is passed in rather than looked up because the caller has already
 * loaded the quotation; fetching the document again only to read its ref would
 * double the round-trips.
 */
export async function getQuotationVersions(quoteRef: string): Promise<LoaderResult<QuotationVersion[]>> {
  if (!quoteRef) return { data: [], source: "api" };
  try {
    const res = await browserFetch(`v1/crm/quotations?limit=200`);
    if (!res.ok) return { data: [], source: "error" };
    const all = normaliseVersions(await res.json());
    return { data: all.filter((v) => v.quoteRef === quoteRef), source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}
