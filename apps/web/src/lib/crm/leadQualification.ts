/**
 * Lead Qualification / Scoring / Segmentation client (BRD §7.3, LQ-001..LQ-004).
 *
 * All calls route through the BFF proxy via browserFetch (httpOnly session,
 * device headers). Read loaders return { source: "error" } on failure so screens
 * can render "—" + DataSourceBadge instead of fabricating a zero/empty as fact.
 */
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";

export type LqSource = "api" | "error";

export interface LoaderResult<T> {
  data: T;
  source: LqSource;
}

/** Canonical lead lifecycle statuses (single source of truth for LQ-003/004). */
export const LEAD_STATUSES = [
  "new",
  "contacted",
  "qualified",
  "unqualified",
  "disqualified",
  "customer",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/* ---------------------------------------------------------------- LQ-003 --- */

export type Temperature = "hot" | "warm" | "cold";
export type Priority = "high" | "medium" | "low";

export const TEMPERATURES: Temperature[] = ["hot", "warm", "cold"];
export const PRIORITIES: Priority[] = ["high", "medium", "low"];

/**
 * Classification patch body for PATCH /v1/crm/contacts/:id/classification.
 * An explicit `null` means "clear this field" — the classify consumer treats
 * null as a clear, whereas an omitted key leaves the stored value untouched.
 */
export interface ClassificationPatch {
  temperature?: Temperature | null;
  priority?: Priority | null;
  segment?: string | null;
  product?: string | null;
  region?: string | null;
  /** Minor units (paise) — already converted from rupees by the caller. */
  expectedValueMinor?: string | null;
}

export async function saveClassification(
  contactId: string,
  patch: ClassificationPatch,
): Promise<void> {
  const res = await browserFetch(`v1/crm/contacts/${contactId}/classification`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

/* ---------------------------------------------------------------- LQ-001 --- */

export interface QualQuestion {
  id?: string;
  text: string;
  /** Weight applied to the answer when scoring. */
  weight: number;
  /** Optional controlled answers; when absent the UI collects free text. */
  options?: Array<{ label: string; value: string; score: number }>;
}

export interface QualificationFramework {
  id?: string;
  name: string;
  businessLine: string;
  active: boolean;
  questions: QualQuestion[];
}

export interface QualifyOutcome {
  outcome: string;
  score: number;
}

function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v) || 0;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function normaliseQuestions(raw: unknown): QualQuestion[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: QualQuestion[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const text = str(r.text);
    if (!text) continue;
    const options = Array.isArray(r.options)
      ? r.options
          .filter((o): o is Record<string, unknown> => !!o && typeof o === "object")
          .map((o) => ({ label: str(o.label), value: str(o.value), score: num(o.score) }))
      : undefined;
    out.push({
      ...(typeof r.id === "string" ? { id: r.id } : {}),
      text,
      weight: num(r.weight),
      ...(options && options.length > 0 ? { options } : {}),
    });
  }
  return out;
}

export function normaliseFrameworks(raw: unknown): QualificationFramework[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { frameworks?: unknown }).frameworks)
      ? (raw as { frameworks: unknown[] }).frameworks
      : raw && typeof raw === "object" && Array.isArray((raw as { data?: unknown }).data)
        ? (raw as { data: unknown[] }).data
        : [];
  const out: QualificationFramework[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const name = str(r.name);
    if (!name) continue;
    out.push({
      ...(typeof r.id === "string" ? { id: r.id } : {}),
      name,
      businessLine: str(r.businessLine),
      active: r.active !== false,
      questions: normaliseQuestions(r.questions),
    });
  }
  return out;
}

export async function getFrameworks(businessLine?: string): Promise<LoaderResult<QualificationFramework[]>> {
  try {
    const qs = businessLine ? `?businessLine=${encodeURIComponent(businessLine)}` : "";
    const res = await browserFetch(`v1/crm/qualification-frameworks${qs}`);
    if (!res.ok) return { data: [], source: "error" };
    return { data: normaliseFrameworks(await res.json()), source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

export async function createFramework(fw: QualificationFramework): Promise<void> {
  const res = await browserFetch("v1/crm/qualification-frameworks", {
    method: "POST",
    body: JSON.stringify(fw),
  });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

export async function updateFramework(id: string, fw: QualificationFramework): Promise<void> {
  const res = await browserFetch(`v1/crm/qualification-frameworks/${id}`, {
    method: "PUT",
    body: JSON.stringify(fw),
  });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

export async function deleteFramework(id: string): Promise<void> {
  const res = await browserFetch(`v1/crm/qualification-frameworks/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

export function normaliseOutcome(raw: unknown): QualifyOutcome {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { outcome: str(r.outcome) || "unknown", score: num(r.score) };
}

export async function qualifyLead(
  leadId: string,
  body: { frameworkId: string; answers: Record<string, string> },
): Promise<QualifyOutcome> {
  const res = await browserFetch(`v1/crm/leads/${leadId}/qualify`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
  return normaliseOutcome(await res.json());
}

/* ---------------------------------------------------------------- LQ-002 --- */

export type ScoreFnType = "linear" | "step" | "boolean";
export const SCORE_FN_TYPES: ScoreFnType[] = ["linear", "step", "boolean"];

export interface LeadScoreRule {
  attribute: string;
  weight: number;
  scoreFnType: ScoreFnType;
  /** Opaque JSON params for the score function, edited as raw text. */
  params: Record<string, unknown>;
  enabled: boolean;
}

export interface ScoreHistoryEntry {
  score: number;
  previousScore: number;
  factors: string[];
  source: string;
  reason: string;
  scoredAt: string;
}

export function normaliseScoreRules(raw: unknown): LeadScoreRule[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { rules?: unknown }).rules)
      ? (raw as { rules: unknown[] }).rules
      : [];
  const out: LeadScoreRule[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const attribute = str(r.attribute);
    if (!attribute) continue;
    const fn = str(r.scoreFnType);
    out.push({
      attribute,
      weight: num(r.weight),
      scoreFnType: (SCORE_FN_TYPES as string[]).includes(fn) ? (fn as ScoreFnType) : "linear",
      params: r.params && typeof r.params === "object" ? (r.params as Record<string, unknown>) : {},
      enabled: r.enabled !== false,
    });
  }
  return out;
}

export async function getScoreRules(): Promise<LoaderResult<LeadScoreRule[]>> {
  try {
    const res = await browserFetch("v1/crm/lead-score-rules");
    if (!res.ok) return { data: [], source: "error" };
    return { data: normaliseScoreRules(await res.json()), source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

export async function saveScoreRules(rules: LeadScoreRule[]): Promise<void> {
  const res = await browserFetch("v1/crm/lead-score-rules", {
    method: "PUT",
    body: JSON.stringify({ rules }),
  });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

export function normaliseScoreHistory(raw: unknown): ScoreHistoryEntry[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { history?: unknown }).history)
      ? (raw as { history: unknown[] }).history
      : [];
  const out: ScoreHistoryEntry[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    out.push({
      score: num(r.score),
      previousScore: num(r.previousScore),
      factors: Array.isArray(r.factors) ? r.factors.map(String) : [],
      source: str(r.source),
      reason: str(r.reason),
      scoredAt: str(r.scoredAt),
    });
  }
  return out;
}

export async function getScoreHistory(leadId: string): Promise<LoaderResult<ScoreHistoryEntry[]>> {
  try {
    const res = await browserFetch(`v1/crm/leads/${leadId}/score-history`);
    if (!res.ok) return { data: [], source: "error" };
    return { data: normaliseScoreHistory(await res.json()), source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

/* ---------------------------------------------------------------- LQ-004 --- */

export interface LeadReasonCode {
  code: string;
  label: string;
  appliesToStatus: string;
  active: boolean;
}

export function normaliseReasonCodes(raw: unknown): LeadReasonCode[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { codes?: unknown }).codes)
      ? (raw as { codes: unknown[] }).codes
      : raw && typeof raw === "object" && Array.isArray((raw as { data?: unknown }).data)
        ? (raw as { data: unknown[] }).data
        : [];
  const out: LeadReasonCode[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const code = str(r.code);
    if (!code) continue;
    out.push({
      code,
      label: str(r.label) || code,
      appliesToStatus: str(r.appliesToStatus),
      active: r.active !== false,
    });
  }
  return out;
}

export async function getReasonCodes(): Promise<LoaderResult<LeadReasonCode[]>> {
  try {
    const res = await browserFetch("v1/crm/lead-reason-codes");
    if (!res.ok) return { data: [], source: "error" };
    return { data: normaliseReasonCodes(await res.json()), source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

export async function saveReasonCodes(codes: LeadReasonCode[]): Promise<void> {
  const res = await browserFetch("v1/crm/lead-reason-codes", {
    method: "PUT",
    body: JSON.stringify({ codes }),
  });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

/** Reason codes offered for a given target status (active + matching, or unscoped). */
export function reasonCodesForStatus(codes: LeadReasonCode[], targetStatus: string): LeadReasonCode[] {
  return codes.filter(
    (c) => c.active && (!c.appliesToStatus || c.appliesToStatus === targetStatus),
  );
}

export interface TransitionResult {
  /** True when the backend accepted the change asynchronously (HTTP 202). */
  accepted: boolean;
}

/**
 * Transition a lead. `reasonCode` is omitted entirely for a governed status
 * that has no configured reason codes (the caller supplies free-text `reason`
 * instead) — never send a sentinel code the backend would 422-reject.
 * Returns whether the change was accepted async (202) vs applied synchronously.
 */
export async function transitionLead(
  leadId: string,
  body: { targetStatus: string; reasonCode?: string; reason?: string },
): Promise<TransitionResult> {
  const res = await browserFetch(`v1/crm/leads/${leadId}/transition`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
  return { accepted: res.status === 202 };
}
