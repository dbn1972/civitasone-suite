/**
 * Lead Qualification / Scoring / Segmentation client (BRD §7.3, LQ-001..LQ-004).
 *
 * All calls route through the BFF proxy via browserFetch (httpOnly session,
 * device headers). Read loaders return { source: "error" } on failure so screens
 * can render "—" + DataSourceBadge instead of fabricating a zero/empty as fact.
 */
import { browserFetch, errorMessageFromResponse, UserFacingError } from "@/lib/api/browserClient";
import { referenceFromHeaders } from "@/lib/errorCatalogue";

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

/**
 * Canonical display labels for a lead/contact status — single source of truth so
 * the contacts list, the New Contact form and the Edit form all name a status the
 * same way (GAP-CRM-CONTACTS-06 / NEW-05). Before this map the list printed the
 * raw enum ("qualified") while the New Contact form relabelled the SAME values as
 * "Engaged Stakeholder"/"Inactive Stakeholder", so one status had two names across
 * the module. Decision (M03): use the plain, honest status word rather than the
 * invented "stakeholder" wording, which did not match the enum semantics.
 */
export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  unqualified: "Unqualified",
  disqualified: "Disqualified",
  customer: "Customer",
};

/** StatusPill tone for each lead status (covers every status incl. disqualified). */
export const LEAD_STATUS_TONES: Record<LeadStatus, "good" | "warn" | "mut" | "bad" | "info"> = {
  new: "info",
  contacted: "warn",
  qualified: "good",
  unqualified: "mut",
  disqualified: "bad",
  customer: "good",
};

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
  /** Optimistic-lock version read from the server; echoed on PUT (GAP-CRM-QUALIFICATION-FRAMEWORKS-02). */
  version?: number;
}

/** 409 VERSION_CONFLICT: another admin saved this framework while it was open. */
export class FrameworkConflictError extends Error {
  constructor() {
    super(
      "This framework was changed by someone else while you were editing it. Reload to see their version, then re-apply your changes.",
    );
    this.name = "FrameworkConflictError";
  }
}

/** 409 QUESTION_HAS_ANSWERS: a removed question already has lead answers. */
export class QuestionHasAnswersError extends Error {
  constructor() {
    super(
      "A question you removed has already been answered on leads, so it cannot be deleted without losing those answers. Restore the question (you can set its weight to 0 to stop it affecting scores) and save again.",
    );
    this.name = "QuestionHasAnswersError";
  }
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
    const text = str(r.text) || str(r.prompt);
    if (!text) continue;
    const rule = r.outcomeRule && typeof r.outcomeRule === "object" ? (r.outcomeRule as Record<string, unknown>) : {};
    const ruleOptions =
      r.answerType === "select" && rule.options && typeof rule.options === "object"
        ? Object.entries(rule.options as Record<string, unknown>).map(([value, score]) => ({ label: value, value, score: num(score) }))
        : undefined;
    const options = Array.isArray(r.options)
      ? r.options
          .filter((o): o is Record<string, unknown> => !!o && typeof o === "object")
          .map((o) => ({ label: str(o.label), value: str(o.value), score: num(o.score) }))
      : ruleOptions;
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
      ...(typeof r.version === "number" ? { version: r.version } : {}),
    });
  }
  return out;
}

export async function getFrameworks(businessLine?: string): Promise<LoaderResult<QualificationFramework[]>> {
  try {
    // GAP-CRM-QUALIFICATION-FRAMEWORKS-04: business line is an open vocabulary matched
    // case-insensitively. Frameworks are stored lowercase (editor normalises on save),
    // so lowercase+trim the query here too — a lead whose businessLine is "Government "
    // then still matches a framework saved as "government".
    const normalised = businessLine?.trim().toLowerCase();
    const qs = normalised ? `?businessLine=${encodeURIComponent(normalised)}` : "";
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
    body: JSON.stringify(frameworkToWire(fw)),
  });
  if (!res.ok) throw new UserFacingError(await errorMessageFromResponse(res), referenceFromHeaders(res.headers));
}

/** Map the editor model to the crm-service wire shape (prompt/answerType/outcomeRule/order). */
export function frameworkToWire(fw: QualificationFramework): Record<string, unknown> {
  return {
    name: fw.name,
    businessLine: fw.businessLine,
    active: fw.active,
    ...(fw.version !== undefined ? { version: fw.version } : {}),
    questions: fw.questions.map((q, order) => ({
      // Echo the id so the server updates in place and answers stay attached.
      ...(q.id ? { id: q.id } : {}),
      prompt: q.text,
      weight: q.weight,
      order,
      ...(q.options && q.options.length > 0
        ? {
            answerType: "select",
            outcomeRule: { options: Object.fromEntries(q.options.map((o) => [o.value, o.score])) },
          }
        : { answerType: "bool", outcomeRule: {} }),
    })),
  };
}

export async function updateFramework(id: string, fw: QualificationFramework): Promise<void> {
  const res = await browserFetch(`v1/crm/qualification-frameworks/${id}`, {
    method: "PUT",
    body: JSON.stringify(frameworkToWire(fw)),
  });
  if (res.status === 409) {
    const code = await res
      .clone()
      .json()
      .then((b: { error?: { code?: string }; code?: string }) => b?.error?.code ?? b?.code)
      .catch(() => undefined);
    if (code === "QUESTION_HAS_ANSWERS") throw new QuestionHasAnswersError();
    throw new FrameworkConflictError();
  }
  if (!res.ok) throw new UserFacingError(await errorMessageFromResponse(res), referenceFromHeaders(res.headers));
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

/**
 * Score-function kinds, kept in exact lock-step with the crm-service validator
 * (services/crm-service/src/modules/leads/score-rules-validators.ts
 * `scoreFnTypeEnum`): presence | map | recency | numeric_threshold. The UI used
 * to offer linear/step/boolean, none of which the backend accepts, so every
 * save 400'd on `scoreFnType`. GAP-CRM-LEAD-SCORING-02.
 */
export type ScoreFnType = "presence" | "map" | "recency" | "numeric_threshold";
export const SCORE_FN_TYPES: ScoreFnType[] = ["presence", "map", "recency", "numeric_threshold"];

/** Human labels for each score function, shown next to the raw enum in the editor. */
export const SCORE_FN_LABELS: Record<ScoreFnType, string> = {
  presence: "Presence (has a value)",
  map: "Map (value → score)",
  recency: "Recency (days since)",
  numeric_threshold: "Numeric threshold",
};

/**
 * One-line description of the params each score function expects, so an admin
 * knows the shape to type before the backend rejects it. Mirrors
 * score-rules-domain.ts buildScoreFn().
 */
export const SCORE_FN_PARAM_HINTS: Record<ScoreFnType, string> = {
  presence: '{"present":70,"absent":20}',
  map: '{"values":{"referral":90,"website":70},"default":20}',
  recency: '{"tiers":[{"maxDays":7,"score":100}],"beyondScore":20,"absentScore":10}',
  numeric_threshold: '{"tiers":[{"min":100,"score":80}],"default":0}',
};

/**
 * Attributes the built-in default rules score on (score-rules-domain.ts
 * DEFAULT_SCORE_RULE_CONFIGS). Offered as suggestions so an admin picks a known
 * lead field instead of a typo that silently never scores
 * (GAP-CRM-LEAD-SCORING-03). The backend `attribute` column is a free
 * varchar(64), so a custom attribute is still allowed — the editor only *warns*
 * on an unrecognised one rather than blocking it.
 */
export const DEFAULT_SCORE_ATTRIBUTES = ["leadSource", "company", "lastActivityAt", "email"] as const;

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function isNum(v: unknown): boolean {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Validate a score-function's params against the shape buildScoreFn
 * (score-rules-domain.ts) actually reads, so a mistyped params blob is caught in
 * the editor rather than silently mis-scoring every lead. Returns an error
 * string or null when valid. Params must already be a parsed object.
 * GAP-CRM-LEAD-SCORING-02.
 */
export function validateScoreFnParams(type: ScoreFnType, params: Record<string, unknown>): string | null {
  switch (type) {
    case "presence":
      if (params.present !== undefined && !isNum(params.present)) return "“present” must be a number.";
      if (params.absent !== undefined && !isNum(params.absent)) return "“absent” must be a number.";
      return null;
    case "map": {
      if (params.values !== undefined) {
        if (!isObject(params.values)) return "“values” must be an object of value → score.";
        for (const v of Object.values(params.values)) if (!isNum(v)) return "Every entry in “values” must be a number.";
      }
      if (params.default !== undefined && !isNum(params.default)) return "“default” must be a number.";
      return null;
    }
    case "recency": {
      if (params.tiers !== undefined) {
        if (!Array.isArray(params.tiers)) return "“tiers” must be an array of {maxDays, score}.";
        for (const t of params.tiers) {
          if (!isObject(t) || !isNum(t.maxDays) || !isNum(t.score)) return "Each tier needs numeric “maxDays” and “score”.";
        }
      }
      if (params.beyondScore !== undefined && !isNum(params.beyondScore)) return "“beyondScore” must be a number.";
      if (params.absentScore !== undefined && !isNum(params.absentScore)) return "“absentScore” must be a number.";
      return null;
    }
    case "numeric_threshold": {
      if (params.tiers !== undefined) {
        if (!Array.isArray(params.tiers)) return "“tiers” must be an array of {min, score}.";
        for (const t of params.tiers) {
          if (!isObject(t) || !isNum(t.min) || !isNum(t.score)) return "Each tier needs numeric “min” and “score”.";
        }
      }
      if (params.default !== undefined && !isNum(params.default)) return "“default” must be a number.";
      return null;
    }
    default:
      return null;
  }
}

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
      scoreFnType: (SCORE_FN_TYPES as string[]).includes(fn) ? (fn as ScoreFnType) : "presence",
      params: r.params && typeof r.params === "object" ? (r.params as Record<string, unknown>) : {},
      enabled: r.enabled !== false,
    });
  }
  return out;
}

/**
 * GAP-CRM-LEAD-SCORING-05 / GAP-CRM-LEAD-REASON-CODES-04: list-level
 * optimistic-concurrency metadata the backend returns on GET and the editor
 * sends back on PUT (ETag header or a `version`/`meta` in the body).
 */
export interface ConcurrencyMeta {
  version?: string;
  updatedBy?: string;
  updatedAt?: string;
}

/** Extract the list version + last-changed metadata from a config GET response. */
async function readConcurrencyMeta(res: Response, body: unknown): Promise<ConcurrencyMeta> {
  const etag = res.headers?.get("etag") ?? undefined;
  const obj = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const meta = obj.meta && typeof obj.meta === "object" ? (obj.meta as Record<string, unknown>) : {};
  const bodyVersion = typeof obj.version === "string" && obj.version.length > 0 ? obj.version : undefined;
  const version = etag ?? bodyVersion;
  const out: ConcurrencyMeta = {};
  if (version) out.version = version;
  if (typeof meta.updatedBy === "string" && meta.updatedBy.length > 0) out.updatedBy = meta.updatedBy;
  if (typeof meta.updatedAt === "string" && meta.updatedAt.length > 0) out.updatedAt = meta.updatedAt;
  return out;
}

/** Thrown by saveScoreRules/saveReasonCodes when the list changed since load. */
export class ConfigConflictError extends Error {
  constructor(message = "This configuration was changed by another admin. Reload to see the latest, then re-apply your changes.") {
    super(message);
    this.name = "ConfigConflictError";
  }
}

export async function getScoreRules(): Promise<LoaderResult<LeadScoreRule[]> & { meta?: ConcurrencyMeta }> {
  try {
    const res = await browserFetch("v1/crm/lead-score-rules");
    if (!res.ok) return { data: [], source: "error" };
    const body = (await res.json()) as unknown;
    const meta = await readConcurrencyMeta(res, body);
    return { data: normaliseScoreRules(body), source: "api", meta };
  } catch {
    return { data: [], source: "error" };
  }
}

export async function saveScoreRules(rules: LeadScoreRule[], version?: string): Promise<string | undefined> {
  // F3-03: the server rejects an empty config PUT with 422 unless confirmEmpty=true.
  const path = rules.length === 0 ? "v1/crm/lead-score-rules?confirmEmpty=true" : "v1/crm/lead-score-rules";
  const res = await browserFetch(path, {
    method: "PUT",
    // GAP-CRM-LEAD-SCORING-05: send the version as If-Match so the backend
    // rejects a stale write (409) instead of silently overwriting a concurrent
    // admin's change.
    ...(version ? { headers: { "If-Match": version } } : {}),
    body: JSON.stringify({ rules, ...(version ? { version } : {}) }),
  });
  if (res.status === 409) throw new ConfigConflictError(await errorMessageFromResponse(res));
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
  const etag = res.headers?.get("etag") ?? undefined;
  if (etag) return etag;
  try {
    const body = (await res.json()) as { version?: unknown };
    return typeof body.version === "string" ? body.version : undefined;
  } catch {
    return undefined;
  }
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

/**
 * Valid `appliesToStatus` values, kept in exact lock-step with the crm-service
 * validator (reason-codes-validators.ts `REASON_CODE_TARGET_STATUSES`). The UI
 * previously offered the lead-lifecycle statuses plus an "any status" blank,
 * none of which the backend enum accepts, so a saved code 400'd. Codes are also
 * lowercase snake_case server-side (regex /^[a-z0-9_]+$/). GAP-CRM-LEAD-REASON-CODES-03.
 */
export const REASON_CODE_TARGET_STATUSES = ["nurture", "recycled", "disqualified", "new", "qualified"] as const;
export type ReasonCodeTargetStatus = (typeof REASON_CODE_TARGET_STATUSES)[number];

/**
 * GAP-CRM-LEAD-REASON-CODES-05 (COPY): human labels for the reason-code target
 * statuses. The select used to print the raw enum ("disqualified"); the value
 * stays the raw enum but the option text shows the title-cased label.
 */
export const REASON_CODE_STATUS_LABELS: Record<ReasonCodeTargetStatus, string> = {
  nurture: "Nurture",
  recycled: "Recycled",
  disqualified: "Disqualified",
  new: "New",
  qualified: "Qualified",
};

/** code must be non-empty lowercase snake_case, matching the backend regex. */
export const REASON_CODE_PATTERN = /^[a-z0-9_]+$/;

export interface ReasonCodeRowError {
  code?: string;
  label?: string;
  appliesToStatus?: string;
}

/**
 * Validate a reason-code list against the exact crm-service contract: each code
 * matches REASON_CODE_PATTERN and is <=48 chars, each label is 1-160 chars, the
 * status is one of REASON_CODE_TARGET_STATUSES, and (code, appliesToStatus) is
 * unique. Returns a per-row error map (empty when the whole list is valid) so the
 * editor can mark the exact offending fields rather than round-tripping to a raw
 * 400. Mirrors reasonCodeSchema + the (tenant, status, code) upsert key.
 */
export function validateReasonCodes(codes: LeadReasonCode[]): Map<number, ReasonCodeRowError> {
  const errors = new Map<number, ReasonCodeRowError>();
  const seen = new Map<string, number>();
  codes.forEach((c, idx) => {
    const err: ReasonCodeRowError = {};
    const code = c.code.trim();
    if (!code) err.code = "A code is required.";
    else if (code.length > 48) err.code = "Code must be 48 characters or fewer.";
    else if (!REASON_CODE_PATTERN.test(code)) err.code = "Use lowercase letters, numbers and underscores only.";
    const label = c.label.trim();
    if (!label) err.label = "A label is required.";
    else if (label.length > 160) err.label = "Label must be 160 characters or fewer.";
    if (!(REASON_CODE_TARGET_STATUSES as readonly string[]).includes(c.appliesToStatus)) {
      err.appliesToStatus = "Choose a status this reason applies to.";
    }
    if (!err.code && !err.appliesToStatus) {
      const key = `${c.appliesToStatus}::${code}`;
      if (seen.has(key)) err.code = "Duplicate code for this status.";
      else seen.set(key, idx);
    }
    if (err.code || err.label || err.appliesToStatus) errors.set(idx, err);
  });
  return errors;
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

export async function getReasonCodes(): Promise<LoaderResult<LeadReasonCode[]> & { meta?: ConcurrencyMeta }> {
  try {
    const res = await browserFetch("v1/crm/lead-reason-codes");
    if (!res.ok) return { data: [], source: "error" };
    const body = (await res.json()) as unknown;
    const meta = await readConcurrencyMeta(res, body);
    return { data: normaliseReasonCodes(body), source: "api", meta };
  } catch {
    return { data: [], source: "error" };
  }
}

export async function saveReasonCodes(codes: LeadReasonCode[], version?: string): Promise<string | undefined> {
  // F3-03: the server rejects an empty config PUT with 422 unless confirmEmpty=true.
  const path = codes.length === 0 ? "v1/crm/lead-reason-codes?confirmEmpty=true" : "v1/crm/lead-reason-codes";
  const res = await browserFetch(path, {
    method: "PUT",
    // GAP-CRM-LEAD-REASON-CODES-04: send the version as If-Match so the backend
    // rejects a stale write (409) instead of silently overwriting a concurrent
    // admin's change.
    ...(version ? { headers: { "If-Match": version } } : {}),
    body: JSON.stringify({ codes, ...(version ? { version } : {}) }),
  });
  if (res.status === 409) throw new ConfigConflictError(await errorMessageFromResponse(res));
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
  const etag = res.headers?.get("etag") ?? undefined;
  if (etag) return etag;
  try {
    const body = (await res.json()) as { version?: unknown };
    return typeof body.version === "string" ? body.version : undefined;
  } catch {
    return undefined;
  }
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
