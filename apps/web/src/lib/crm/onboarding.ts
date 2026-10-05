/**
 * Customer onboarding client (P1-9) — crm-service `onboarding` module.
 *
 * CRM CUSTOMER onboarding: a case is opened upstream when a deal is won, then
 * walks a stage state-machine behind a KYC gate. This module is list → detail →
 * stage/KYC actions; there is NO create endpoint (see routes.ts).
 *
 * House contract: every call routes through browserFetch (BFF proxy, httpOnly
 * session, device headers). Read loaders return { source: "error" } on failure
 * so the screen renders "—" + DataSourceBadge rather than fabricating an empty
 * list / zero as fact. The stage + KYC helpers MIRROR the backend state machine
 * (services/crm-service/src/modules/onboarding/domain.ts) so the UI only offers
 * legal actions — but the backend remains the source of truth: an illegal or
 * KYC-gated transition still returns 422, and that failure is never silent —
 * advanceStage/recordKyc reject and the caller shows a clerk-safe catalogued
 * message (errorMessageFromResponse, UX-020), not the backend's raw 422
 * code/reason text.
 */
import { browserFetch, errorMessageFromResponse, UserFacingError } from "@/lib/api/browserClient";
import { referenceFromHeaders } from "@/lib/errorCatalogue";

export type OnbSource = "api" | "error" | "not-found";

export interface LoaderResult<T> {
  data: T;
  source: OnbSource;
}

/** True when the backend accepted the mutation asynchronously (HTTP 202). */
export interface MutationResult {
  accepted: boolean;
}

/* ============================================ state machine (mirror of BE) == */

/**
 * Onboarding stages — must match ONBOARDING_STAGES in the backend domain.ts.
 * initiated → documents_submitted → verification → provisioning → completed,
 * with `cancelled` reachable from any live stage. `completed` and `cancelled`
 * are terminal.
 */
export const ONBOARDING_STAGES = [
  "initiated",
  "documents_submitted",
  "verification",
  "provisioning",
  "completed",
  "cancelled",
] as const;
export type OnboardingStage = (typeof ONBOARDING_STAGES)[number];

/** KYC statuses — must match KYC_STATUSES in the backend domain.ts. */
export const KYC_STATUSES = ["pending", "submitted", "verified", "rejected"] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];

/** Minimum characters the backend requires in a cancellation reason. */
export const CANCELLATION_REASON_MIN_LENGTH = 10;

/** Stage transition table — mirror of TRANSITIONS in domain.ts. */
const STAGE_TRANSITIONS: Readonly<Record<OnboardingStage, readonly OnboardingStage[]>> = {
  initiated: ["documents_submitted", "cancelled"],
  documents_submitted: ["verification", "cancelled"],
  verification: ["provisioning", "cancelled"],
  provisioning: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

/** KYC transition table — mirror of KYC_TRANSITIONS in domain.ts. */
const KYC_TRANSITIONS: Readonly<Record<KycStatus, readonly KycStatus[]>> = {
  pending: ["submitted"],
  submitted: ["verified", "rejected"],
  rejected: ["submitted"],
  verified: [],
};

export function isOnboardingStage(value: string): value is OnboardingStage {
  return (ONBOARDING_STAGES as readonly string[]).includes(value);
}

export function isKycStatus(value: string): value is KycStatus {
  return (KYC_STATUSES as readonly string[]).includes(value);
}

export function isTerminalStage(stage: OnboardingStage): boolean {
  return STAGE_TRANSITIONS[stage].length === 0;
}

export function allowedNextStages(stage: OnboardingStage): readonly OnboardingStage[] {
  return STAGE_TRANSITIONS[stage] ?? [];
}

export function canTransition(from: OnboardingStage, to: OnboardingStage): boolean {
  return (STAGE_TRANSITIONS[from] ?? []).includes(to);
}

export function allowedNextKycStatuses(status: KycStatus): readonly KycStatus[] {
  return KYC_TRANSITIONS[status] ?? [];
}

export function canKycTransition(from: KycStatus, to: KycStatus): boolean {
  return (KYC_TRANSITIONS[from] ?? []).includes(to);
}

/** THE GATE — stages that may not be entered until KYC has passed (mirror BE). */
export function requiresKycVerification(to: OnboardingStage): boolean {
  return to === "completed";
}

export function isKycSatisfied(status: KycStatus): boolean {
  return status === "verified";
}

/** Both halves of the KYC gate. Matches isKycGateSatisfied in domain.ts. */
export function isKycGateSatisfied(to: OnboardingStage, status: KycStatus): boolean {
  return !requiresKycVerification(to) || isKycSatisfied(status);
}

export function requiresCancellationReason(to: OnboardingStage): boolean {
  return to === "cancelled";
}

export function isValidCancellationReason(reason: string | undefined | null): boolean {
  return (reason ?? "").trim().length >= CANCELLATION_REASON_MIN_LENGTH;
}

/**
 * A single offered next-stage option for the transition control. `kycBlocked`
 * is true when this stage is legal in the sequence but the KYC gate would refuse
 * it right now (target requires 'verified' KYC and KYC is not verified). The UI
 * still shows it — disabled, with the reason — rather than hiding it, so the
 * clerk understands WHY completion is unavailable. The backend re-checks and
 * returns 422 regardless.
 */
export interface NextStageOption {
  stage: OnboardingStage;
  requiresKyc: boolean;
  kycBlocked: boolean;
  requiresReason: boolean;
}

export function nextStageOptions(stage: OnboardingStage, kyc: KycStatus): NextStageOption[] {
  return allowedNextStages(stage).map((to) => ({
    stage: to,
    requiresKyc: requiresKycVerification(to),
    kycBlocked: requiresKycVerification(to) && !isKycSatisfied(kyc),
    requiresReason: requiresCancellationReason(to),
  }));
}

/* ================================================================ labels === */

export const STAGE_LABELS: Record<OnboardingStage, string> = {
  initiated: "Initiated",
  documents_submitted: "Documents submitted",
  verification: "Verification",
  provisioning: "Provisioning",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** Icon + tone per stage — status is shown as icon+label, never colour-only. */
export const STAGE_META: Record<OnboardingStage, { icon: string; tone: string }> = {
  initiated: { icon: "🆕", tone: "neutral" },
  documents_submitted: { icon: "📄", tone: "info" },
  verification: { icon: "🔎", tone: "info" },
  provisioning: { icon: "⚙️", tone: "info" },
  completed: { icon: "✅", tone: "success" },
  cancelled: { icon: "🚫", tone: "danger" },
};

export const KYC_LABELS: Record<KycStatus, string> = {
  pending: "Pending",
  submitted: "Submitted",
  verified: "Verified",
  rejected: "Rejected",
};

export const KYC_META: Record<KycStatus, { icon: string; tone: string }> = {
  pending: { icon: "⏳", tone: "neutral" },
  submitted: { icon: "📤", tone: "info" },
  verified: { icon: "✅", tone: "success" },
  rejected: { icon: "⛔", tone: "danger" },
};

export function stageLabel(stage: string): string {
  return isOnboardingStage(stage) ? STAGE_LABELS[stage] : stage;
}

export function kycLabel(status: string): string {
  return isKycStatus(status) ? KYC_LABELS[status] : status;
}

/**
 * GAP-CRM-ONBOARDING-06 / -DETAIL-07: map a STAGE_META/KYC_META `tone` to a
 * shared StatusPill variant, so stage/KYC render as theme-safe tone pills
 * rather than cross-platform-inconsistent emoji glyphs. The `.pill` variants
 * (good/warn/bad/mut/info) follow the theme in both light and dark mode.
 */
export type OnbPillVariant = "good" | "warn" | "mut" | "bad" | "info";
const TONE_TO_PILL: Record<string, OnbPillVariant> = {
  success: "good",
  danger: "bad",
  warn: "warn",
  info: "info",
  neutral: "mut",
};

export function stagePillVariant(stage: string): OnbPillVariant {
  const tone = isOnboardingStage(stage) ? STAGE_META[stage].tone : "neutral";
  return TONE_TO_PILL[tone] ?? "info";
}

export function kycPillVariant(status: string): OnbPillVariant {
  const tone = isKycStatus(status) ? KYC_META[status].tone : "neutral";
  return TONE_TO_PILL[tone] ?? "info";
}

/* ================================================================= model === */

export interface OnboardingCase {
  id: string;
  dealId: string;
  accountId: string | null;
  stage: string;
  kycStatus: string;
  kycReference: string | null;
  kycVerifiedAt: string | null;
  completedAt: string | null;
  cancellationReason: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  /**
   * GAP-CRM-ONBOARDING-01: human-readable deal / account names so a clerk can
   * tell cases apart without opening each one. The onboarding module stores
   * only opaque ids and (by L2 module isolation) never joins to the deals /
   * accounts modules, so the backend list cannot return these without a
   * forbidden cross-module join — they are resolved in the web layer
   * (resolveCaseNames) from the deals and accounts list endpoints. A backend
   * that later supplies them inline is tolerated too (normaliseCase reads them
   * when present).
   */
  accountName: string | null;
  dealName: string | null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function nullableStr(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v) || 0;
}

/** Tolerate a bare array OR an { items | data } envelope (list route uses data). */
function toArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    for (const k of ["data", "items"]) {
      const v = (raw as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

export function normaliseCase(raw: unknown): OnboardingCase | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  if (!id) return null;
  return {
    id,
    dealId: str(r.dealId),
    accountId: nullableStr(r.accountId),
    stage: str(r.stage),
    kycStatus: str(r.kycStatus),
    kycReference: nullableStr(r.kycReference),
    kycVerifiedAt: nullableStr(r.kycVerifiedAt),
    completedAt: nullableStr(r.completedAt),
    cancellationReason: nullableStr(r.cancellationReason),
    createdAt: str(r.createdAt),
    updatedAt: str(r.updatedAt),
    version: num(r.version),
    accountName: nullableStr(r.accountName),
    dealName: nullableStr(r.dealName),
  };
}

export function normaliseCases(raw: unknown): OnboardingCase[] {
  return toArray(raw)
    .map(normaliseCase)
    .filter((c): c is OnboardingCase => c !== null);
}

/* =============================================================== loaders === */

export interface ListFilters {
  stage?: OnboardingStage;
  accountId?: string;
  /**
   * GAP-CRM-ONBOARDING-02: page size (backend caps it at 200 — shared
   * list-query MAX_PAGE_SIZE; a larger value is clamped server-side) and the
   * 1-based page. The list route accepts both; the UI pages client-side over
   * the fetched set, so it requests a full page here.
   */
  limit?: number;
  page?: number;
}

export async function getOnboardingCases(filters: ListFilters = {}): Promise<LoaderResult<OnboardingCase[]>> {
  const params = new URLSearchParams();
  if (filters.stage) params.set("stage", filters.stage);
  if (filters.accountId) params.set("accountId", filters.accountId);
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
  if (filters.page !== undefined) params.set("page", String(filters.page));
  const qs = params.toString();
  try {
    const res = await browserFetch(`v1/crm/onboarding-cases${qs ? `?${qs}` : ""}`);
    if (!res.ok) return { data: [], source: "error" };
    return { data: normaliseCases(await res.json()), source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

export async function getOnboardingCase(id: string): Promise<LoaderResult<OnboardingCase | null>> {
  try {
    const res = await browserFetch(`v1/crm/onboarding-cases/${encodeURIComponent(id)}`);
    // A genuine 404 means the case does not exist / was removed — distinct from an
    // outage. The detail view shows the "does not exist" message for not-found and
    // reserves the "try again" retry message for a real error.
    if (res.status === 404) return { data: null, source: "not-found" };
    if (!res.ok) return { data: null, source: "error" };
    return { data: normaliseCase(await res.json()), source: "api" };
  } catch {
    return { data: null, source: "error" };
  }
}

/* ============================================================= mutations === */

/**
 * GAP-CRM-ONBOARDING-01 — deal/account name lookup.
 *
 * The onboarding module stores only opaque ids and never joins to the deals or
 * accounts modules (L2 isolation), so names are resolved in the web layer from
 * the deals + accounts list endpoints and merged onto the cases client-side.
 */
export interface OnboardingLookups {
  dealNames: Record<string, string>;
  accountNames: Record<string, string>;
}

function namesFromList(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of toArray(raw)) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const id = str(r.id);
    const name = str(r.name);
    if (id && name) out[id] = name;
  }
  return out;
}

/** Fetch the deal + account name maps used to label onboarding rows. */
export async function getOnboardingLookups(): Promise<OnboardingLookups> {
  const [dealsRes, accountsRes] = await Promise.allSettled([
    browserFetch("v1/crm/deals?limit=500"),
    browserFetch("v1/crm/accounts?limit=500"),
  ]);
  const dealNames =
    dealsRes.status === "fulfilled" && dealsRes.value.ok ? namesFromList(await dealsRes.value.json()) : {};
  const accountNames =
    accountsRes.status === "fulfilled" && accountsRes.value.ok ? namesFromList(await accountsRes.value.json()) : {};
  return { dealNames, accountNames };
}

/** Merge resolved names onto cases; a missing name is left null (never a UUID). */
export function resolveCaseNames(cases: OnboardingCase[], lookups: OnboardingLookups): OnboardingCase[] {
  return cases.map((c) => ({
    ...c,
    dealName: c.dealName ?? lookups.dealNames[c.dealId] ?? null,
    accountName: c.accountName ?? (c.accountId ? lookups.accountNames[c.accountId] ?? null : null),
  }));
}

export interface AdvanceStageInput {
  toStage: OnboardingStage;
  /** Required (≥10 chars) only when cancelling; ignored otherwise by the BE. */
  reason?: string;
  /** Optimistic-concurrency guard; the BE 409s on a stale version. */
  version?: number;
}

/**
 * Advance the stage. The backend enforces the state machine AND the KYC gate: an
 * illegal transition or a premature completion returns 422 with the allowed set
 * / KYC reason in the body ("INVALID_TRANSITION: cannot move from …" /
 * "KYC_NOT_VERIFIED: …"). We never swallow that failure, but since UX-020 we
 * also never show it raw — errorMessageFromResponse maps it to a clerk-safe
 * catalogued message instead (docs/ENTERPRISE-GAP-REPORT-2026-09-07.md
 * UX-003/UX-016/UX-020: an internal state-machine code is still developer
 * phrasing, the same bug class those gaps close everywhere else).
 */
export async function advanceStage(id: string, input: AdvanceStageInput): Promise<MutationResult> {
  const body: Record<string, unknown> = { toStage: input.toStage };
  if (input.reason !== undefined) body.reason = input.reason;
  if (input.version !== undefined) body.version = input.version;
  const res = await browserFetch(`v1/crm/onboarding-cases/${encodeURIComponent(id)}/stage`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new UserFacingError(await errorMessageFromResponse(res), referenceFromHeaders(res.headers));
  return { accepted: res.status === 202 };
}

export interface RecordKycInput {
  status: KycStatus;
  reference?: string;
  version?: number;
}

/**
 * Record a KYC outcome. The backend enforces the KYC lifecycle (an illegal
 * status move returns 422 INVALID_KYC_TRANSITION with the allowed set) and
 * requires an approver role for verified/rejected (403). Neither failure is
 * swallowed, but per UX-020 neither is shown raw either — see advanceStage
 * above.
 */
export async function recordKyc(id: string, input: RecordKycInput): Promise<MutationResult> {
  const body: Record<string, unknown> = { status: input.status };
  if (input.reference !== undefined) body.reference = input.reference;
  if (input.version !== undefined) body.version = input.version;
  const res = await browserFetch(`v1/crm/onboarding-cases/${encodeURIComponent(id)}/kyc`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new UserFacingError(await errorMessageFromResponse(res), referenceFromHeaders(res.headers));
  return { accepted: res.status === 202 };
}
