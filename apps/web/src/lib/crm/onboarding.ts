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
 * KYC-gated transition still returns 422 and that reason is surfaced verbatim.
 */
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";

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
}

export async function getOnboardingCases(filters: ListFilters = {}): Promise<LoaderResult<OnboardingCase[]>> {
  const params = new URLSearchParams();
  if (filters.stage) params.set("stage", filters.stage);
  if (filters.accountId) params.set("accountId", filters.accountId);
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
 * / KYC reason in the body — errorMessageFromResponse surfaces it verbatim
 * ("INVALID_TRANSITION: cannot move from …" / "KYC_NOT_VERIFIED: …"). We never
 * swallow it.
 */
export async function advanceStage(id: string, input: AdvanceStageInput): Promise<MutationResult> {
  const body: Record<string, unknown> = { toStage: input.toStage };
  if (input.reason !== undefined) body.reason = input.reason;
  if (input.version !== undefined) body.version = input.version;
  const res = await browserFetch(`v1/crm/onboarding-cases/${encodeURIComponent(id)}/stage`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
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
 * requires an approver role for verified/rejected (403). Surface either verbatim.
 */
export async function recordKyc(id: string, input: RecordKycInput): Promise<MutationResult> {
  const body: Record<string, unknown> = { status: input.status };
  if (input.reference !== undefined) body.reference = input.reference;
  if (input.version !== undefined) body.version = input.version;
  const res = await browserFetch(`v1/crm/onboarding-cases/${encodeURIComponent(id)}/kyc`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
  return { accepted: res.status === 202 };
}
