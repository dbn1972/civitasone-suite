/**
 * Campaign & Source Management client (BRD §7.9, MK-001, MK-004).
 *
 * All calls route through the BFF proxy via browserFetch (httpOnly session,
 * device headers). The gateway maps the web-facing `notification/*` prefix onto
 * the notification-service `/notifications/*` upstream, so a campaign resource
 * the service exposes at `/notifications/campaigns` is reached from the browser
 * as `notification/campaigns` — mirroring how the templates screen already
 * fetches `notification/templates`.
 *
 * Read loaders return { source: "error" } on failure so screens render "—" +
 * DataSourceBadge instead of fabricating a zero/empty as fact. A campaign whose
 * ROI could not be loaded must never display "0%".
 *
 * Money (budget / cost / attributed revenue) is carried as a minor-unit (paise)
 * integer STRING end-to-end. The create form converts a clerk-entered rupee
 * decimal with rupeesToMinorString (no float) and everything displays with
 * formatMoney. Never do rupee/paise arithmetic with Number.
 */
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";

export type Source = "api" | "error";

export interface LoaderResult<T> {
  data: T;
  source: Source;
}

/* --------------------------------------------------------------- helpers -- */

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function optStr(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
function intNum(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return Number(v.trim());
  return 0;
}
/** A minor-unit money field may arrive as a number or a string; keep it a string. */
function minorStr(v: unknown): string {
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(Math.round(v));
  return "0";
}
/** roiBps is a signed integer OR null (null when cost is 0 — cannot compute). */
function roiBpsOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return Number(v.trim());
  return null;
}

/** Tolerate bare-array vs { items | data | <named> } wrappers (backend concurrent). */
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
function unwrapTotal(raw: unknown): number | undefined {
  if (raw && typeof raw === "object" && "total" in raw) {
    const t = (raw as Record<string, unknown>).total;
    if (typeof t === "number") return t;
    if (typeof t === "string" && /^\d+$/.test(t)) return Number(t);
  }
  return undefined;
}

/* ============================================================ constants === */

/** MK-001 campaign lifecycle states (single source of truth). */
export const CAMPAIGN_STATUSES = [
  "draft",
  "scheduled",
  "sending",
  "sent",
  "cancelled",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  sending: "Sending",
  sent: "Sent",
  cancelled: "Cancelled",
};

/** Human label for a campaign status; unknown values are shown verbatim. */
export function campaignStatusLabel(status: string): string {
  const key = String(status ?? "").toLowerCase();
  return STATUS_LABELS[key] ?? (status || "Unknown");
}

/**
 * Format a return-on-investment basis-points figure for display.
 *
 * roiBps is a signed integer where 100 bps = 1% (so +4200 bps = +42.0%), or
 * null when actual cost is 0 and ROI is undefined. A null MUST render "—" — a
 * campaign whose ROI cannot be computed is never shown as "0%".
 *
 * Formatting is integer-safe (works on tenths of a percent, i.e. bps/10) so a
 * value like 4205 bps renders "+42.1%" without float drift, and positive
 * figures carry a leading "+".
 *
 *   formatRoiBps(null)   -> "—"
 *   formatRoiBps(0)      -> "0.0%"
 *   formatRoiBps(4200)   -> "+42.0%"
 *   formatRoiBps(4205)   -> "+42.1%"
 *   formatRoiBps(-1234)  -> "-12.3%"
 *   formatRoiBps(12500)  -> "+125.0%"
 */
export function formatRoiBps(roiBps: number | null): string {
  if (roiBps === null || roiBps === undefined || !Number.isFinite(roiBps)) return "—";
  const bps = Math.trunc(roiBps);
  const sign = bps > 0 ? "+" : bps < 0 ? "-" : "";
  const abs = Math.abs(bps);
  // Work in tenths-of-a-percent (10 bps = 0.1%) to keep one decimal place exact.
  const tenths = Math.round(abs / 10);
  const whole = Math.floor(tenths / 10);
  const frac = tenths % 10;
  return `${sign}${whole}.${frac}%`;
}

/* =============================================================== types ==== */

export interface Campaign {
  id: string;
  name: string;
  objective?: string;
  status: string;
  /** Minor-unit (paise) integer string. */
  budgetMinor?: string;
  currency?: string;
  audienceSegmentId?: string;
  scheduledAt?: string;
  createdAt?: string;
}

export interface CampaignMetrics {
  campaignId: string;
  recipients: number;
  delivered: number;
  failed: number;
  responses: number;
  conversions: number;
  /** Minor-unit (paise) integer strings. */
  budgetMinor: string;
  actualCostMinor: string;
  attributedRevenueMinor: string;
  /** 100 bps = 1%; null when actual cost is 0 (ROI undefined). */
  roiBps: number | null;
  currency?: string;
}

export interface CampaignSegment {
  id: string;
  name: string;
}

export interface CampaignTemplate {
  id: string;
  name: string;
  channel?: string;
}

export interface CreateCampaignInput {
  name: string;
  templateId: string;
  /** Non-empty list of recipient addresses/ids — the backend requires >= 1. */
  recipients: string[];
  objective?: string;
  /** Minor-unit (paise) integer string. */
  budgetMinor?: string;
  currency?: string;
  audienceSegmentId?: string;
  scheduledAt?: string;
}

/* =========================================================== normalisers = */

export function normaliseCampaign(raw: unknown): Campaign | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  if (!id) return null;
  return {
    id,
    name: str(r.name),
    objective: optStr(r.objective),
    status: str(r.status) || "draft",
    budgetMinor: r.budgetMinor === undefined || r.budgetMinor === null ? undefined : minorStr(r.budgetMinor),
    currency: optStr(r.currency),
    audienceSegmentId: optStr(r.audienceSegmentId),
    scheduledAt: optStr(r.scheduledAt),
    createdAt: optStr(r.createdAt),
  };
}

export function normaliseCampaigns(raw: unknown): Campaign[] {
  return toArray(raw, "campaigns")
    .map(normaliseCampaign)
    .filter((c): c is Campaign => c !== null);
}

export function normaliseMetrics(raw: unknown): CampaignMetrics | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    campaignId: str(r.campaignId),
    recipients: intNum(r.recipients),
    delivered: intNum(r.delivered),
    failed: intNum(r.failed),
    responses: intNum(r.responses),
    conversions: intNum(r.conversions),
    budgetMinor: minorStr(r.budgetMinor),
    actualCostMinor: minorStr(r.actualCostMinor),
    attributedRevenueMinor: minorStr(r.attributedRevenueMinor),
    roiBps: roiBpsOrNull(r.roiBps),
    currency: optStr(r.currency),
  };
}

function normaliseSegment(raw: unknown): CampaignSegment | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  if (!id) return null;
  return { id, name: str(r.name) || id };
}

function normaliseTemplate(raw: unknown): CampaignTemplate | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  if (!id) return null;
  return { id, name: str(r.name) || id, channel: optStr(r.channel) };
}

/* ============================================================== loaders == */

export interface CampaignListResult extends LoaderResult<Campaign[]> {
  total?: number;
}

export async function getCampaigns(limit = 50, offset = 0): Promise<CampaignListResult> {
  const q = `?limit=${encodeURIComponent(String(limit))}&offset=${encodeURIComponent(String(offset))}`;
  try {
    const res = await browserFetch(`notification/campaigns${q}`);
    if (!res.ok) return { data: [], source: "error" };
    const raw = await res.json();
    return { data: normaliseCampaigns(raw), total: unwrapTotal(raw), source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

export async function getCampaign(id: string): Promise<LoaderResult<Campaign | null>> {
  try {
    const res = await browserFetch(`notification/campaigns/${encodeURIComponent(id)}`);
    if (!res.ok) return { data: null, source: "error" };
    const raw = await res.json();
    const unwrapped = raw && typeof raw === "object" && "data" in raw ? (raw as Record<string, unknown>).data : raw;
    return { data: normaliseCampaign(unwrapped), source: "api" };
  } catch {
    return { data: null, source: "error" };
  }
}

export async function getCampaignMetrics(id: string): Promise<LoaderResult<CampaignMetrics | null>> {
  try {
    const res = await browserFetch(`notification/campaigns/${encodeURIComponent(id)}/metrics`);
    if (!res.ok) return { data: null, source: "error" };
    const raw = await res.json();
    const unwrapped = raw && typeof raw === "object" && "data" in raw ? (raw as Record<string, unknown>).data : raw;
    return { data: normaliseMetrics(unwrapped), source: "api" };
  } catch {
    return { data: null, source: "error" };
  }
}

export async function getCampaignTemplates(): Promise<LoaderResult<CampaignTemplate[]>> {
  try {
    const res = await browserFetch("notification/templates");
    if (!res.ok) return { data: [], source: "error" };
    const raw = await res.json();
    const list = toArray(raw, "templates").map(normaliseTemplate).filter((t): t is CampaignTemplate => t !== null);
    return { data: list, source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

export async function getCampaignSegments(): Promise<LoaderResult<CampaignSegment[]>> {
  try {
    const res = await browserFetch("v1/segments");
    if (!res.ok) return { data: [], source: "error" };
    const raw = await res.json();
    const list = toArray(raw, "segments").map(normaliseSegment).filter((s): s is CampaignSegment => s !== null);
    return { data: list, source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

/* ============================================================ mutations == */

export async function createCampaign(input: CreateCampaignInput): Promise<void> {
  const res = await browserFetch("notification/campaigns", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

export async function sendCampaign(id: string): Promise<void> {
  const res = await browserFetch(`notification/campaigns/${encodeURIComponent(id)}/send`, { method: "PATCH" });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

export async function cancelCampaign(id: string): Promise<void> {
  const res = await browserFetch(`notification/campaigns/${encodeURIComponent(id)}/cancel`, { method: "PATCH" });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}
